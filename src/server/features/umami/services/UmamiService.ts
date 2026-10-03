import { siteHost } from "@/server/features/bing/bingUrls";
import { UmamiConnectionRepository } from "@/server/features/umami/repositories/UmamiConnectionRepository";
import {
  openUmamiClient,
  sealUmamiCredentials,
} from "@/server/features/umami/umamiAccess";
import { umamiAppError } from "@/server/features/umami/umamiFailures";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { AppError } from "@/server/lib/errors";
import {
  createUmamiClient,
  UMAMI_CLOUD_API_URL,
  type UmamiCredentials,
  type UmamiWebsite,
} from "@/server/lib/umami/umamiClient";
import { UmamiApiError } from "@/server/lib/umami/umamiErrors";

type SaveConnectionResult =
  | { ok: true; websiteCount: number }
  | {
      ok: false;
      reason:
        | "invalid_url"
        | "blocked_url"
        | "auth"
        | "unreachable"
        | "throttled"
        | "not_umami";
      message: string;
    };

/**
 * The API base of a self-hosted instance from what the user typed: https
 * only, public hosts only (the crawler's SSRF policy, DNS included), any
 * sub-path kept, and a pasted trailing /api tolerated.
 */
async function resolveSelfHostedApiUrl(
  input: string,
): Promise<
  | { ok: true; apiUrl: string }
  | { ok: false; reason: "invalid_url" | "blocked_url" }
> {
  const trimmed = input.trim();
  if (/^http:\/\//i.test(trimmed)) return { ok: false, reason: "invalid_url" };
  let normalized: string;
  try {
    normalized = await normalizeAndValidateStartUrl(trimmed);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      ok: false,
      reason:
        error.code === "CRAWL_TARGET_BLOCKED" ? "blocked_url" : "invalid_url",
    };
  }
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.username || url.password) {
    return { ok: false, reason: "invalid_url" };
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api$/i, "");
  return { ok: true, apiUrl: `${url.origin}${path}/api` };
}

const URL_MESSAGES = {
  invalid_url:
    "Enter your Umami instance's https address, like https://umami.example.com.",
  blocked_url:
    "That address points to a private or internal network, which OpenSEO can't reach.",
} as const;

/**
 * Check the credentials against the instance (by listing its websites) and
 * save them sealed on the project. Credentials Umami rejects are never
 * stored. The chosen website carries over when the same instance is saved
 * again and still lists it (a rotated password or key).
 */
async function saveConnection(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  credentials: UmamiCredentials;
  baseUrl?: string;
}): Promise<SaveConnectionResult> {
  let apiUrl = UMAMI_CLOUD_API_URL;
  if (input.credentials.mode === "self_hosted") {
    const resolved = await resolveSelfHostedApiUrl(input.baseUrl ?? "");
    if (!resolved.ok) {
      return {
        ok: false,
        reason: resolved.reason,
        message: URL_MESSAGES[resolved.reason],
      };
    }
    apiUrl = resolved.apiUrl;
  }

  let websites: UmamiWebsite[];
  try {
    websites = await createUmamiClient({
      baseUrl: apiUrl,
      credentials: input.credentials,
    }).listWebsites();
  } catch (error) {
    if (!(error instanceof UmamiApiError)) throw error;
    const reason =
      error.kind === "auth"
        ? "auth"
        : error.kind === "throttled"
          ? "throttled"
          : error.kind === "unreachable"
            ? "unreachable"
            : "not_umami";
    return { ok: false, reason, message: error.message };
  }

  const existing = await UmamiConnectionRepository.getByProjectId(
    input.projectId,
  );
  const kept =
    existing?.baseUrl === apiUrl && existing.mode === input.credentials.mode
      ? websites.find((website) => website.id === existing.websiteId)
      : undefined;
  await UmamiConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    mode: input.credentials.mode,
    baseUrl: apiUrl,
    credentialEncrypted: await sealUmamiCredentials(input.credentials),
    credentialHint:
      input.credentials.mode === "cloud"
        ? input.credentials.apiKey.slice(-4)
        : input.credentials.username,
    connectedByUserId: input.userId,
    websiteId: kept?.id ?? null,
    websiteName: kept?.name ?? null,
    websiteDomain: kept?.domain ?? null,
    teamId: kept?.teamId ?? null,
  });
  return { ok: true, websiteCount: websites.length };
}

/**
 * Every website the saved credentials can read, the user's own and their
 * teams', flagging the one whose domain matches the project's (www and apex
 * are the same site) and the one already chosen. `credentialsInvalid` means
 * the connection must be saved again.
 */
async function listWebsites(input: {
  projectId: string;
  projectDomain: string | null;
}) {
  const connection = await UmamiConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) {
    return { hasCredentials: false, credentialsInvalid: false, websites: [] };
  }
  const client = await openUmamiClient(connection);
  if (!client) {
    return { hasCredentials: true, credentialsInvalid: true, websites: [] };
  }
  let websites: UmamiWebsite[];
  try {
    websites = await client.listWebsites();
  } catch (error) {
    if (error instanceof UmamiApiError && error.kind === "auth") {
      return { hasCredentials: true, credentialsInvalid: true, websites: [] };
    }
    if (error instanceof UmamiApiError) throw umamiAppError(error);
    throw error;
  }
  const projectHost = input.projectDomain
    ? siteHost(input.projectDomain)
    : null;
  return {
    hasCredentials: true,
    credentialsInvalid: false,
    websites: websites.map((website) => ({
      ...website,
      matchesProjectDomain:
        projectHost !== null &&
        website.domain !== null &&
        siteHost(website.domain) === projectHost,
      isSelected: website.id === connection.websiteId,
    })),
  };
}

/** Point the project at one of the websites the saved credentials can read,
 *  remembering the team that owns it. */
async function selectWebsite(input: {
  projectId: string;
  websiteId: string;
}): Promise<{ websiteId: string; websiteName: string }> {
  const connection = await UmamiConnectionRepository.getByProjectId(
    input.projectId,
  );
  const client = connection ? await openUmamiClient(connection) : null;
  if (!client) {
    throw new AppError(
      "NOT_FOUND",
      "Save working Umami credentials before choosing a website.",
    );
  }
  let websites: UmamiWebsite[];
  try {
    websites = await client.listWebsites();
  } catch (error) {
    if (error instanceof UmamiApiError) throw umamiAppError(error);
    throw error;
  }
  const website = websites.find(
    (candidate) => candidate.id.toLowerCase() === input.websiteId.toLowerCase(),
  );
  if (!website) {
    throw new AppError(
      "NOT_FOUND",
      "That website isn't readable with the saved Umami credentials.",
    );
  }
  await UmamiConnectionRepository.setWebsite(input.projectId, {
    websiteId: website.id,
    websiteName: website.name,
    websiteDomain: website.domain,
    teamId: website.teamId,
  });
  return { websiteId: website.id, websiteName: website.name };
}

async function disconnect(projectId: string): Promise<void> {
  await UmamiConnectionRepository.deleteByProjectId(projectId);
}

/** What the integration card shows. Credentials never leave the server; the
 *  hint is a key's last four characters or the username. */
async function getConnectionStatus(projectId: string) {
  const row =
    await UmamiConnectionRepository.getWithConnectorByProjectId(projectId);
  const connection = row?.connection ?? null;
  return {
    hasCredentials: Boolean(connection),
    connected: Boolean(connection?.websiteId),
    mode: connection?.mode ?? null,
    // Self-hosted shows the instance address the user typed, without /api.
    instanceUrl:
      connection?.mode === "self_hosted"
        ? connection.baseUrl.replace(/\/api$/, "")
        : null,
    credentialHint: connection?.credentialHint ?? null,
    website: connection?.websiteId
      ? {
          id: connection.websiteId,
          name: connection.websiteName,
          domain: connection.websiteDomain,
          teamId: connection.teamId,
        }
      : null,
    connectedBy: row?.connectorEmail ?? null,
    connectedAt: connection?.createdAt ?? null,
    lastError: connection?.lastError ?? null,
  };
}

export const UmamiService = {
  saveConnection,
  listWebsites,
  selectWebsite,
  disconnect,
  getConnectionStatus,
};
