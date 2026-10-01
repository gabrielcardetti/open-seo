import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { CrawlerCredentialRepository } from "@/server/features/audit/repositories/CrawlerCredentialRepository";
import {
  checkCloudflareAccessToken,
  type CloudflareAccessProblem,
} from "@/server/features/audit/services/cloudflareAccessToken";
import {
  checkShopifySignature,
  type ShopifySignatureProblem,
} from "@/server/features/audit/services/shopifySignature";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  cloudflareAccessHeaders,
  isCrawlerAccessExpired,
  parseSignatureExpiry,
  shopifyCrawlerHeaders,
  type CrawlerAccess,
  type CrawlerAccessProvider,
} from "@/shared/crawler-access";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";

/**
 * A credential as it exists at rest: in the database and in the audit
 * workflow's persisted params. The two values are ciphertext until
 * `openCrawlerAccess` decrypts them in memory for a crawl. For Cloudflare
 * Access they hold the service token's Client ID and Client Secret.
 */
export interface SealedCrawlerAccess {
  host: string;
  provider: CrawlerAccessProvider;
  signatureInput: string;
  signature: string;
  expiresAt: string | null;
}

/** The plaintext values a user saves, as the client sends them. */
type CrawlerCredentialValues =
  | { provider: "shopify"; signatureInput: string; signature: string }
  | { provider: "cloudflare_access"; clientId: string; clientSecret: string };

type CrawlerCredentialProblem =
  | ShopifySignatureProblem
  | CloudflareAccessProblem;

// Same key as the stored Google OAuth tokens, so self-hosters have one secret
// to set and hosted mode always has it.
async function getEncryptionKey(): Promise<string> {
  const secret = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  if (!secret || secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      `Set BETTER_AUTH_SECRET to at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters to store crawler access credentials. It encrypts them.`,
    );
  }
  return secret;
}

/**
 * What the client is allowed to see. The stored values are access
 * credentials: they never leave the server, in responses, errors, logs, or
 * analytics properties.
 */
interface CrawlerCredentialSummary {
  id: string;
  projectId: string;
  host: string;
  provider: CrawlerAccessProvider;
  createdAt: string;
  expiresAt: string | null;
}

type CredentialRow = Awaited<
  ReturnType<typeof CrawlerCredentialRepository.listForOrganization>
>[number];

function toSummary(row: CredentialRow): CrawlerCredentialSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    host: row.host,
    provider: row.provider,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

async function listCrawlerCredentials(
  organizationId: string,
): Promise<CrawlerCredentialSummary[]> {
  const rows =
    await CrawlerCredentialRepository.listForOrganization(organizationId);
  return rows.map(toSummary);
}

/**
 * A credential the site would ignore on this host (a Shopify signature for
 * another domain, an Access token its policy doesn't let through) comes back
 * as a problem to show next to the form, instead of being stored and failing
 * the crawl.
 */
async function saveCrawlerCredential(input: {
  organizationId: string;
  projectId: string;
  userId: string;
  host: string;
  values: CrawlerCredentialValues;
}): Promise<
  | { credential: CrawlerCredentialSummary }
  | { problem: CrawlerCredentialProblem }
> {
  const key = await getEncryptionKey();
  const { values } = input;
  const stored =
    values.provider === "shopify"
      ? {
          first: values.signatureInput,
          second: values.signature,
          expiresAt: parseSignatureExpiry(values.signatureInput),
          problem: await checkShopifySignature({
            host: input.host,
            signatureInput: values.signatureInput,
            signature: values.signature,
          }),
        }
      : {
          first: values.clientId,
          second: values.clientSecret,
          // Access doesn't tell the client when a service token expires.
          expiresAt: null,
          problem: await checkCloudflareAccessToken({
            host: input.host,
            clientId: values.clientId,
            clientSecret: values.clientSecret,
          }),
        };
  if (stored.problem) return { problem: stored.problem };

  await CrawlerCredentialRepository.upsert({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    host: input.host,
    provider: values.provider,
    signatureInput: await symmetricEncrypt({ key, data: stored.first }),
    signature: await symmetricEncrypt({ key, data: stored.second }),
    expiresAt: stored.expiresAt,
    createdByUserId: input.userId,
  });

  const saved = (
    await CrawlerCredentialRepository.listForOrganization(input.organizationId)
  ).find((row) => row.projectId === input.projectId && row.host === input.host);
  if (!saved) throw new AppError("INTERNAL_ERROR");
  return { credential: toSummary(saved) };
}

async function deleteCrawlerCredential(input: {
  organizationId: string;
  id: string;
}) {
  await CrawlerCredentialRepository.remove(input.organizationId, input.id);
}

/**
 * The credential the audit crawler should replay for this host, if any. An
 * expired one is skipped: Shopify rejects it, and the report names the expiry.
 * Access service tokens have no known expiry, so they are always replayed.
 */
async function resolveCrawlerAccess(
  organizationId: string,
  projectId: string,
  host: string,
): Promise<{ id: string; sealed: SealedCrawlerAccess } | null> {
  const rows = await CrawlerCredentialRepository.findForOrganizationAndHost(
    organizationId,
    projectId,
    host,
  );
  const row = rows.find(
    (candidate) => !isCrawlerAccessExpired(candidate.expiresAt),
  );
  if (!row) return null;

  return {
    id: row.id,
    sealed: {
      host: row.host,
      provider: row.provider,
      signatureInput: row.signatureInput,
      signature: row.signature,
      expiresAt: row.expiresAt,
    },
  };
}

/** Decrypts in memory only. The result must never be persisted or logged. */
async function openCrawlerAccess(
  sealed: SealedCrawlerAccess | null | undefined,
): Promise<CrawlerAccess | null> {
  if (!sealed) return null;
  try {
    const key = await getEncryptionKey();
    const first = await symmetricDecrypt({ key, data: sealed.signatureInput });
    const second = await symmetricDecrypt({ key, data: sealed.signature });
    return {
      host: sealed.host,
      expiresAt: sealed.expiresAt,
      // Workflow params persisted before Access tokens existed carry no
      // provider; those are Shopify signatures.
      headers:
        sealed.provider === "cloudflare_access"
          ? cloudflareAccessHeaders(first, second)
          : shopifyCrawlerHeaders(first, second),
    };
  } catch {
    // A rotated BETTER_AUTH_SECRET makes stored credentials unreadable. Crawl
    // without them rather than fail the audit; the report asks for new ones.
    console.warn(`Could not decrypt crawler access for ${sealed.host}`);
    return null;
  }
}

export const CrawlerCredentialService = {
  listCrawlerCredentials,
  saveCrawlerCredential,
  deleteCrawlerCredential,
  resolveCrawlerAccess,
  openCrawlerAccess,
} as const;
