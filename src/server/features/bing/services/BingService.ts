import { IndexingRepository } from "@/server/features/indexing/IndexingRepository";
import { BING_KEY_PURPOSE } from "@/server/features/bing/bingAccess";
import { bingAppError } from "@/server/features/bing/bingFailures";
import { siteHost } from "@/server/features/bing/bingUrls";
import { BingApiKeyRepository } from "@/server/features/bing/repositories/BingApiKeyRepository";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { createBingClient, type BingSite } from "@/server/lib/bing/bingClient";
import { BingApiError } from "@/server/lib/bing/bingErrors";
import { UpstreamBreaker } from "@/server/features/upstreams/upstreamBreaker";
import { AppError } from "@/server/lib/errors";
import { openSecret, sealSecret } from "@/server/lib/secretBox";

type SaveApiKeyResult =
  | { ok: true; keyHint: string; verifiedSiteCount: number }
  | {
      ok: false;
      reason: "invalid_key" | "throttled" | "unavailable";
      message: string;
    };

/**
 * Check a key against Bing (GetUserSites) and store it encrypted, replacing
 * any key the user saved before — whether that one still works or not. A key
 * Bing rejects is never stored, and a failed check leaves the old key alone.
 */
async function saveApiKey(
  userId: string,
  rawApiKey: string,
): Promise<SaveApiKeyResult> {
  const apiKey = rawApiKey.trim();
  let sites: BingSite[];
  try {
    sites = await createBingClient(apiKey).getUserSites();
  } catch (error) {
    if (!(error instanceof BingApiError)) throw error;
    if (error.kind === "auth") {
      return { ok: false, reason: "invalid_key", message: error.message };
    }
    return {
      ok: false,
      reason: error.kind === "throttled" ? "throttled" : "unavailable",
      message: error.message,
    };
  }

  const now = new Date().toISOString();
  const keyHint = apiKey.slice(-4);
  await BingApiKeyRepository.upsert({
    userId,
    apiKeyEncrypted: await sealSecret(apiKey, BING_KEY_PURPOSE),
    keyHint,
    verifiedAt: now,
  });
  // Projects this member connected were syncing with the old key; give them
  // the new one on the next cron tick.
  await BingConnectionRepository.scheduleSyncForConnector(userId, now);
  return {
    ok: true,
    keyHint,
    verifiedSiteCount: sites.filter((site) => site.isVerified).length,
  };
}

/** Projects connected with this key stop syncing until someone reconnects
 *  them; their connection rows and history stay. */
async function deleteApiKey(userId: string): Promise<void> {
  await BingApiKeyRepository.deleteByUserId(userId);
}

async function getKeyStatus(userId: string) {
  const key = await BingApiKeyRepository.getByUserId(userId);
  return {
    hasKey: Boolean(key),
    keyHint: key?.keyHint ?? null,
    verifiedAt: key?.verifiedAt ?? null,
  };
}

/** The user's own key opened into a client, or null when they have none or
 *  it can't be decrypted any more (a rotated BETTER_AUTH_SECRET). */
async function openUserClient(userId: string) {
  const key = await BingApiKeyRepository.getByUserId(userId);
  if (!key) return { hasKey: false as const, client: null };
  try {
    const apiKey = await openSecret(key.apiKeyEncrypted, BING_KEY_PURPOSE);
    return { hasKey: true as const, client: createBingClient(apiKey) };
  } catch {
    return { hasKey: true as const, client: null };
  }
}

/**
 * The verified sites the user's key can read, flagging the one that matches
 * the project's domain and the one the project is connected to. `keyInvalid`
 * means the user must save a new key.
 */
async function listSites(input: {
  userId: string;
  projectId: string;
  projectDomain: string | null;
}) {
  const { hasKey, client } = await openUserClient(input.userId);
  if (!hasKey) return { hasKey: false, keyInvalid: false, sites: [] };
  if (!client) return { hasKey: true, keyInvalid: true, sites: [] };

  let sites: BingSite[];
  try {
    sites = await client.getUserSites();
  } catch (error) {
    if (error instanceof BingApiError && error.kind === "auth") {
      return { hasKey: true, keyInvalid: true, sites: [] };
    }
    if (error instanceof BingApiError) throw bingAppError(error);
    throw error;
  }

  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  const projectHost = input.projectDomain
    ? siteHost(input.projectDomain)
    : null;
  return {
    hasKey: true,
    keyInvalid: false,
    sites: sites
      .filter((site) => site.isVerified)
      .map((site) => ({
        siteUrl: site.url,
        matchesProjectDomain:
          projectHost !== null && siteHost(site.url) === projectHost,
        isSelected: connection?.siteUrl === site.url,
      })),
  };
}

/** Connect the project to one of the user's verified Bing sites, stored
 *  exactly as Bing spells it. The first sync runs on the next cron tick. */
async function setSite(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  siteUrl: string;
}): Promise<void> {
  const { hasKey, client } = await openUserClient(input.userId);
  if (!hasKey || !client) {
    throw new AppError(
      "NOT_FOUND",
      "Save a working Bing Webmaster API key before choosing a site.",
    );
  }
  let sites: BingSite[];
  try {
    sites = await client.getUserSites();
  } catch (error) {
    if (error instanceof BingApiError) throw bingAppError(error);
    throw error;
  }
  const match = sites.find((site) => site.url === input.siteUrl);
  if (!match) {
    throw new AppError(
      "NOT_FOUND",
      "That site isn't in the Bing Webmaster account behind your API key.",
    );
  }
  if (!match.isVerified) {
    throw new AppError(
      "FORBIDDEN",
      "That site isn't verified in Bing Webmaster Tools yet.",
    );
  }
  await BingConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    siteUrl: match.url,
    connectedByUserId: input.userId,
    nextSyncAt: new Date().toISOString(),
  });
  // A Bing connection is a channel for announcing URLs, so start watching the
  // sitemap. The first check is a baseline and announces nothing.
  await IndexingRepository.ensureSettings(input.projectId);
}

/** Drop the project's connection. Snapshot history stays, keyed by site, and
 *  comes back if the same site is connected again. */
async function disconnect(projectId: string): Promise<void> {
  await BingConnectionRepository.deleteByProjectId(projectId);
}

async function getConnectionStatus(input: {
  projectId: string;
  userId: string;
}) {
  const [row, userKey, outage] = await Promise.all([
    BingConnectionRepository.getWithConnectorByProjectId(input.projectId),
    BingApiKeyRepository.getByUserId(input.userId),
    UpstreamBreaker.getOutage("bing_api"),
  ]);
  const connection = row?.connection ?? null;
  const connectorKey =
    connection && connection.connectedByUserId !== input.userId
      ? await BingApiKeyRepository.getByUserId(connection.connectedByUserId)
      : userKey;
  return {
    connected: Boolean(connection),
    currentUserHasKey: Boolean(userKey),
    keyHint: userKey?.keyHint ?? null,
    siteUrl: connection?.siteUrl ?? null,
    connectedBy: row?.connectorEmail ?? null,
    connectedByCurrentUser: connection?.connectedByUserId === input.userId,
    // The connector deleted their key: syncing stops until someone reconnects.
    connectorKeyMissing: Boolean(connection) && !connectorKey,
    connectedAt: connection?.createdAt ?? null,
    syncEnabled: connection?.syncEnabled ?? false,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    nextSyncAt: connection?.nextSyncAt ?? null,
    lastSyncError: connection?.lastSyncError ?? null,
    // Bing's API (or its relay) is unreachable for the whole deployment;
    // syncs wait for the breaker's retry time.
    outage,
    quota:
      connection?.quotaCheckedAt != null
        ? {
            dailyRemaining: connection.dailyQuotaRemaining,
            monthlyRemaining: connection.monthlyQuotaRemaining,
            checkedAt: connection.quotaCheckedAt,
          }
        : null,
  };
}

async function setSyncEnabled(
  projectId: string,
  syncEnabled: boolean,
): Promise<void> {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection) {
    throw new AppError("NOT_FOUND", "Bing Webmaster Tools isn't connected.");
  }
  // Turning sync on syncs on the next tick unless a sync is already scheduled.
  const nextSyncAt = syncEnabled
    ? connection.syncEnabled && connection.nextSyncAt
      ? connection.nextSyncAt
      : new Date().toISOString()
    : connection.nextSyncAt;
  await BingConnectionRepository.setSyncEnabled({
    projectId,
    syncEnabled,
    nextSyncAt,
  });
}

export const BingService = {
  saveApiKey,
  deleteApiKey,
  getKeyStatus,
  listSites,
  setSite,
  disconnect,
  getConnectionStatus,
  setSyncEnabled,
};
