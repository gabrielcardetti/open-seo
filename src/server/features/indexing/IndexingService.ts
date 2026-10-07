/**
 * Indexing setup and history: the project's IndexNow key (generated once or
 * imported, then verified against the published key file), auto-submit
 * settings, the deploy hook secret, and the submission ledger.
 *
 * Problems the user can fix come back as plain-language data rather than
 * thrown errors, because thrown errors reach the client as a bare code.
 */
import { createProbe } from "@/server/lib/agent-readiness/probe";
import { sha256Hex } from "@/server/lib/audit/ids";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { AppError } from "@/server/lib/errors";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { UpstreamBreaker } from "@/server/features/upstreams/upstreamBreaker";
import type {
  UrlSubmissionChannel,
  UrlSubmissionSource,
  UrlSubmissionStatus,
} from "@/shared/indexing";
import { GoogleIndexingService } from "./GoogleIndexingService";
import { IndexingRepository } from "./IndexingRepository";
import { isSameSite, projectHost } from "./site";
import { UrlSubmissionRepository } from "./UrlSubmissionRepository";
import { UrlSubmissionService } from "./UrlSubmissionService";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_HOURS = 24;
/** IndexNow's key format. */
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const randomHex = (byteLength: number) =>
  toHex(crypto.getRandomValues(new Uint8Array(byteLength)));

async function requireProject(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project) throw new AppError("NOT_FOUND");
  return project;
}

/** Where the key file must be served: the custom location, or /{key}.txt. */
function keyFileUrl(
  key: string | null,
  keyLocation: string | null,
  host: string | null,
): string | null {
  if (!key) return null;
  if (keyLocation) return keyLocation;
  return host ? `https://${host}/${key}.txt` : null;
}

function deployHookUrl(publicOrigin: string, projectId: string) {
  return `${publicOrigin}/api/indexing/hook/${projectId}`;
}

async function getSetup(projectId: string, publicOrigin: string) {
  const project = await requireProject(projectId);
  const [settings, bing, outages, googleIndexing] = await Promise.all([
    IndexingRepository.getSettings(projectId),
    BingConnectionRepository.getByProjectId(projectId),
    UpstreamBreaker.listOutages(),
    GoogleIndexingService.getView(projectId, project.domain),
  ]);
  const host = projectHost(project.domain);
  const key = settings?.indexnowKey ?? null;
  const keyLocation = settings?.indexnowKeyLocation ?? null;
  return {
    domain: project.domain,
    host,
    indexNow: {
      key,
      keyLocation,
      keyFileUrl: keyFileUrl(key, keyLocation, host),
      // The file must contain exactly this, nothing else.
      keyFileContent: key,
      verifiedAt: settings?.indexnowVerifiedAt ?? null,
      lastError: settings?.indexnowLastError ?? null,
    },
    autoSubmitEnabled: settings?.autoSubmitEnabled ?? true,
    dedupeHours: settings?.dedupeHours ?? DEFAULT_DEDUPE_HOURS,
    deployHook: {
      configured: Boolean(settings?.deployHookSecretHash),
      url: deployHookUrl(publicOrigin, projectId),
    },
    sitemap: {
      lastCheckAt: settings?.lastSitemapCheckAt ?? null,
      nextCheckAt: settings?.nextSitemapCheckAt ?? null,
      lastError: settings?.lastSitemapError ?? null,
    },
    bing: bing
      ? {
          siteUrl: bing.siteUrl,
          dailyQuotaRemaining: bing.dailyQuotaRemaining,
          monthlyQuotaRemaining: bing.monthlyQuotaRemaining,
          quotaCheckedAt: bing.quotaCheckedAt,
        }
      : null,
    // Google's Indexing API (job-posting pages only): health of the saved
    // service account. Checked, never used to send, for now.
    googleIndexing,
    autoChannel: await UrlSubmissionService.resolveAutoChannel(
      projectId,
      settings,
    ),
    // IndexNow or Bing's API (or the relay in front of them) unreachable:
    // sending on that channel is paused until the breaker closes.
    outages: outages.filter((outage) =>
      outage.upstream === "bing_api" ? Boolean(bing) : Boolean(key),
    ),
  };
}

/** A random 32-hex key, only when the project has none (never replaced). */
async function generateKey(projectId: string): Promise<{ key: string }> {
  await requireProject(projectId);
  await IndexingRepository.setKeyIfAbsent(projectId, randomHex(16));
  const settings = await IndexingRepository.getSettings(projectId);
  if (!settings?.indexnowKey) throw new AppError("INTERNAL_ERROR");
  return { key: settings.indexnowKey };
}

/** Adopt a key already published on the site. Resets verification. */
async function importKey(
  projectId: string,
  input: { key: string; keyLocation?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await requireProject(projectId);
  const key = input.key.trim();
  if (!KEY_PATTERN.test(key)) {
    return {
      ok: false,
      error:
        "An IndexNow key is 8 to 128 characters: letters, digits and dashes only.",
    };
  }
  const keyLocation = input.keyLocation?.trim() || null;
  if (keyLocation) {
    const host = projectHost(project.domain);
    let parsed: URL | null = null;
    try {
      parsed = new URL(keyLocation);
    } catch {
      // handled below
    }
    if (
      !parsed ||
      parsed.protocol !== "https:" ||
      !host ||
      !isSameSite(parsed.hostname, host)
    ) {
      return {
        ok: false,
        error: `The key file location must be an https URL on ${host ?? "the project's domain"}.`,
      };
    }
  }
  await IndexingRepository.upsertSettings(projectId, {
    indexnowKey: key,
    indexnowKeyLocation: keyLocation,
    indexnowVerifiedAt: null,
    indexnowLastError: null,
  });
  return { ok: true };
}

/** Fetch the key file the way IndexNow will, and record the verdict. */
async function verifyKey(projectId: string): Promise<{
  verified: boolean;
  verifiedAt: string | null;
  error: string | null;
}> {
  const project = await requireProject(projectId);
  const settings = await IndexingRepository.getSettings(projectId);
  const key = settings?.indexnowKey ?? null;
  const url = keyFileUrl(
    key,
    settings?.indexnowKeyLocation ?? null,
    projectHost(project.domain),
  );
  if (!key || !url) {
    return {
      verified: false,
      verifiedAt: null,
      error: key
        ? "Set the project's website domain first."
        : "Generate or import a key first.",
    };
  }

  const error = await checkKeyFile(url, key);
  const verifiedAt = error ? null : new Date().toISOString();
  await IndexingRepository.upsertSettings(projectId, {
    indexnowVerifiedAt: verifiedAt,
    indexnowLastError: error,
  });
  return { verified: !error, verifiedAt, error };
}

const isRedirect = (status: number) => status >= 300 && status < 400;

/** One GET of a validated URL, redirects not followed; a string says why not. */
async function fetchKeyFile(url: string) {
  try {
    await normalizeAndValidateStartUrl(url);
  } catch {
    return `OpenSEO is not allowed to fetch ${url}.`;
  }
  const response = await createProbe(fetch, { followRedirects: false })(url);
  return response ?? `Could not reach ${url}: the request failed or timed out.`;
}

/** `location` when it is the same https URL on the other www/apex host. */
function wwwTwin(url: string, location: string | null): string | null {
  if (!location) return null;
  try {
    const from = new URL(url);
    const to = new URL(location, url);
    const twin =
      to.protocol === "https:" &&
      to.hostname !== from.hostname &&
      isSameSite(to.hostname, from.hostname) &&
      to.pathname === from.pathname &&
      to.search === from.search;
    return twin ? to.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Null when the file at `url` holds exactly `key`; otherwise why not.
 * Redirects are not followed: IndexNow reads the key file at its URL. The one
 * exception is a redirect to the same path on the site's other www/apex host,
 * which is checked in turn (validated like the first), because the site's
 * URLs live on that host and IndexNow reads the key file there.
 */
async function checkKeyFile(url: string, key: string): Promise<string | null> {
  let target = url;
  let response = await fetchKeyFile(target);
  if (typeof response === "string") return response;
  const twin = isRedirect(response.status)
    ? wwwTwin(target, response.headers.get("location"))
    : null;
  if (twin) {
    target = twin;
    response = await fetchKeyFile(target);
    if (typeof response === "string") return response;
  }
  if (isRedirect(response.status)) {
    return `${target} redirects elsewhere. IndexNow reads the key file at that exact URL, so serve it there directly, without a redirect.`;
  }
  if (response.status !== 200) {
    return `${target} answered HTTP ${response.status}. Publish the key file there, then verify again.`;
  }
  if (response.body.trim() !== key) {
    return `The file at ${target} must contain only the key (${key}), nothing else.`;
  }
  return null;
}

async function updateSettings(
  projectId: string,
  input: { autoSubmitEnabled: boolean; dedupeHours: number },
) {
  await requireProject(projectId);
  await IndexingRepository.upsertSettings(projectId, input);
}

/** A new deploy hook secret, returned once; only its SHA-256 is stored. */
async function rotateDeployHookSecret(projectId: string) {
  await requireProject(projectId);
  const secret = `osh_${randomHex(24)}`;
  await IndexingRepository.upsertSettings(projectId, {
    deployHookSecretHash: await sha256Hex(secret),
  });
  return { secret };
}

/** Compares the whole string, so the time taken says nothing about where it differs. */
function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

/** True when `secret` is the project's current deploy hook secret. */
async function authorizeDeployHook(
  projectId: string,
  secret: string,
): Promise<boolean> {
  const [settings, hash] = await Promise.all([
    IndexingRepository.getSettings(projectId),
    sha256Hex(secret),
  ]);
  const expected = settings?.deployHookSecretHash;
  return Boolean(expected) && timingSafeEqual(hash, expected ?? "");
}

async function getLog(
  projectId: string,
  input: {
    url?: string;
    status?: UrlSubmissionStatus;
    source?: UrlSubmissionSource;
    channel?: UrlSubmissionChannel;
    limit: number;
    offset: number;
  },
) {
  const { limit, offset, ...filters } = input;
  const now = Date.now();
  const [page, last7Days, last30Days] = await Promise.all([
    UrlSubmissionRepository.listSubmissions(projectId, filters, {
      limit,
      offset,
    }),
    UrlSubmissionRepository.countByStatusSince(
      projectId,
      new Date(now - 7 * DAY_MS).toISOString(),
    ),
    UrlSubmissionRepository.countByStatusSince(
      projectId,
      new Date(now - 30 * DAY_MS).toISOString(),
    ),
  ]);
  return {
    rows: page.rows,
    total: page.total,
    counts: { last7Days, last30Days },
  };
}

export const IndexingService = {
  getSetup,
  generateKey,
  importKey,
  verifyKey,
  updateSettings,
  rotateDeployHookSecret,
  authorizeDeployHook,
  getLog,
} as const;
