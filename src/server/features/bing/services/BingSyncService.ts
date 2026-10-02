import { openBingClientForProject } from "@/server/features/bing/bingAccess";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { BingSnapshotRepository } from "@/server/features/bing/repositories/BingSnapshotRepository";
import {
  BingApiError,
  BingNotConnectedError,
} from "@/server/lib/bing/bingErrors";

const DAY_MS = 24 * 60 * 60 * 1000;
// Link counts change slowly and page through many calls: refresh weekly.
const LINK_COUNT_INTERVAL_DAYS = 7;
const LINK_COUNT_MAX_PAGES = 20;
// A cron tick syncs a few projects, then leaves the backlog to later ticks.
const SYNCS_PER_TICK = 3;
const TICK_DEADLINE_MS = 3 * 60 * 1000;
// "Sync now" can't be used to hammer Bing's per-key rate limit: at most one
// sync of any kind starts per project in this window.
const MIN_MANUAL_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 2000;

const NOT_CONNECTED_SYNC_ERROR =
  "The API key used for this connection is gone or unreadable. Reconnect Bing Webmaster Tools with a saved key.";

type DatasetStatus = "ok" | "skipped" | "failed";

type BingSyncResult = {
  siteUrl: string;
  datasets: Record<string, DatasetStatus>;
  errors: string[];
  /** Why later datasets weren't tried: the key was rejected or lost access
   *  to the site (`key`), or Bing throttled it (`throttled`). Every later
   *  call would fail the same way and spend more of the key's allowance. */
  stoppedBy: "key" | "throttled" | null;
};

function daysBetween(fromDate: string, toDate: string): number {
  return (
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
    DAY_MS
  );
}

/**
 * Download everything the Bing Webmaster API serves for the project's site
 * into the snapshot tables. Each dataset is best-effort: one failing method
 * is recorded and the others still run. A rejected or throttled key (or a key
 * that lost the site) stops the sync, since every later call would fail the
 * same way. Throws BingNotConnectedError when there's no usable connection.
 *
 * The snapshot writes are keyed by the site read at the start, so a sync that
 * is still running when the project switches sites only adds to the old
 * site's history, and its status is dropped (see recordSyncResult).
 */
async function syncProject(projectId: string): Promise<BingSyncResult> {
  const { connection, client } = await openBingClientForProject(projectId);
  const siteUrl = connection.siteUrl;
  const scope = { projectId, siteUrl };
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  let quota: { daily: number; monthly: number; checkedAt: string } | undefined;

  const steps: Array<[string, () => Promise<DatasetStatus>]> = [
    [
      "traffic",
      async () => {
        const days = await client.getRankAndTrafficStats(siteUrl);
        await BingSnapshotRepository.upsertTraffic(scope, days, now);
        return "ok";
      },
    ],
    [
      "queries",
      async () => {
        const rows = await client.getQueryStats(siteUrl);
        await BingSnapshotRepository.upsertQueryStats(scope, rows, now);
        return "ok";
      },
    ],
    [
      "pages",
      async () => {
        const rows = await client.getPageStats(siteUrl);
        await BingSnapshotRepository.upsertPageStats(scope, rows, now);
        return "ok";
      },
    ],
    [
      "crawl_stats",
      async () => {
        const days = await client.getCrawlStats(siteUrl);
        await BingSnapshotRepository.upsertCrawlDays(scope, days, now);
        return "ok";
      },
    ],
    [
      "crawl_issues",
      async () => {
        // Resolving relies on a complete answer, so this only runs when the
        // call succeeded; a failure leaves every open issue open.
        const issues = await client.getCrawlIssues(siteUrl);
        await BingSnapshotRepository.replaceCrawlIssues(scope, issues, now);
        return "ok";
      },
    ],
    [
      "sitemaps",
      async () => {
        const feeds = await client.getFeeds(siteUrl);
        await BingSnapshotRepository.upsertSitemaps(scope, feeds, now);
        return "ok";
      },
    ],
    [
      "quota",
      async () => {
        const remaining = await client.getUrlSubmissionQuota(siteUrl);
        quota = { ...remaining, checkedAt: now };
        return "ok";
      },
    ],
    [
      "link_counts",
      async () => {
        const latest =
          await BingSnapshotRepository.getLatestLinkCaptureDate(scope);
        if (latest && daysBetween(latest, today) < LINK_COUNT_INTERVAL_DAYS) {
          return "skipped";
        }
        const links: Array<{ url: string; count: number }> = [];
        let totalPages = 1;
        for (
          let page = 0;
          page < Math.min(totalPages, LINK_COUNT_MAX_PAGES);
          page++
        ) {
          const result = await client.getLinkCounts(siteUrl, page);
          if (result.links.length === 0) break;
          links.push(...result.links);
          totalPages = result.totalPages;
        }
        await BingSnapshotRepository.insertLinkCounts(scope, today, links);
        return "ok";
      },
    ],
  ];

  const datasets: Record<string, DatasetStatus> = {};
  const errors: string[] = [];
  let stoppedBy: BingSyncResult["stoppedBy"] = null;
  for (const [name, run] of steps) {
    if (stoppedBy) {
      datasets[name] = "skipped";
      continue;
    }
    try {
      datasets[name] = await run();
    } catch (error) {
      datasets[name] = "failed";
      errors.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!(error instanceof BingApiError)) {
        console.error("Bing sync dataset failed", { projectId, name, error });
      } else if (error.kind === "auth" || error.kind === "site_access") {
        stoppedBy = "key";
      } else if (error.kind === "throttled") {
        stoppedBy = "throttled";
      }
    }
  }

  await BingConnectionRepository.recordSyncResult({
    ...scope,
    // Only a sync that stored something counts as a sync; a dead key must not
    // block "Sync now" after the user fixes it.
    lastSyncedAt: Object.values(datasets).includes("ok") ? now : undefined,
    lastSyncError:
      errors.length > 0 ? errors.join("; ").slice(0, MAX_ERROR_LENGTH) : null,
    quota,
  });
  return { siteUrl, datasets, errors, stoppedBy };
}

/**
 * Daily syncs, driven by the five-minute cron. Each due project is claimed
 * with a compare-and-set that also advances it a day, so overlapping ticks
 * never sync one project twice and a failing project is retried tomorrow, not
 * every five minutes. Never throws: one cron job must not stop the others.
 */
async function runScheduledSyncs(): Promise<{ ran: number; failed: number }> {
  const tally = { ran: 0, failed: 0 };
  try {
    const startedAt = Date.now();
    const due = await BingConnectionRepository.getDue(
      new Date(startedAt).toISOString(),
      SYNCS_PER_TICK,
    );
    for (const connection of due) {
      if (Date.now() - startedAt > TICK_DEADLINE_MS) break;
      if (!connection.nextSyncAt) continue;
      const claimed = await BingConnectionRepository.claimSync({
        projectId: connection.projectId,
        observedNextSyncAt: connection.nextSyncAt,
        nextSyncAt: new Date(startedAt + DAY_MS).toISOString(),
        scheduled: true,
      });
      if (!claimed) continue;
      try {
        const result = await syncProject(connection.projectId);
        if (result.errors.length > 0) tally.failed += 1;
        else tally.ran += 1;
      } catch (error) {
        tally.failed += 1;
        if (error instanceof BingNotConnectedError) {
          await BingConnectionRepository.recordSyncResult({
            projectId: connection.projectId,
            siteUrl: connection.siteUrl,
            lastSyncError: NOT_CONNECTED_SYNC_ERROR,
          });
        } else {
          console.error("Scheduled Bing sync failed", {
            projectId: connection.projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (due.length > 0) {
      console.log("Scheduled Bing sync tick", { due: due.length, ...tally });
    }
  } catch (error) {
    console.error("Scheduled Bing syncs failed", error);
  }
  return tally;
}

type SyncNowResult =
  | { status: "not_connected" }
  | { status: "too_soon"; lastAttemptAt: string; retryAfterSeconds: number }
  | ({ status: "synced" } & BingSyncResult);

/**
 * Every sync, manual or scheduled, is claimed by moving `nextSyncAt` a day
 * past its start, so the last attempt started a day before `nextSyncAt` —
 * whether it succeeded or not, which a throttled key's syncs never do.
 * Saving a key, choosing a site and turning sync on set `nextSyncAt` to now,
 * which allows a sync straight away.
 */
function tooSoon(
  nextSyncAt: string | null,
  nowMs: number,
): Extract<SyncNowResult, { status: "too_soon" }> | null {
  if (!nextSyncAt) return null;
  const lastAttemptMs = Date.parse(nextSyncAt) - DAY_MS;
  const elapsed = nowMs - lastAttemptMs;
  if (elapsed >= MIN_MANUAL_SYNC_INTERVAL_MS) return null;
  return {
    status: "too_soon",
    lastAttemptAt: new Date(lastAttemptMs).toISOString(),
    retryAfterSeconds: Math.ceil(
      (MIN_MANUAL_SYNC_INTERVAL_MS - elapsed) / 1000,
    ),
  };
}

/**
 * An on-demand sync for the app and agents, at most once per ten minutes. It
 * stands in for today's scheduled sync, and claims the project with the same
 * compare-and-set as the cron, so a double click or the app and an agent at
 * once start one sync, not two.
 */
async function syncNow(projectId: string): Promise<SyncNowResult> {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection) return { status: "not_connected" };
  const nowMs = Date.now();
  const waiting = tooSoon(connection.nextSyncAt, nowMs);
  if (waiting) return waiting;
  const nextSyncAt = new Date(nowMs + DAY_MS).toISOString();
  const claimed = await BingConnectionRepository.claimSync({
    projectId,
    observedNextSyncAt: connection.nextSyncAt,
    nextSyncAt,
    scheduled: false,
  });
  if (!claimed) {
    // Another sync claimed the project between the read and the claim.
    const current = await BingConnectionRepository.getByProjectId(projectId);
    if (!current) return { status: "not_connected" };
    return (
      tooSoon(current.nextSyncAt, nowMs) ?? {
        status: "too_soon",
        lastAttemptAt: new Date(nowMs).toISOString(),
        retryAfterSeconds: MIN_MANUAL_SYNC_INTERVAL_MS / 1000,
      }
    );
  }
  try {
    return { status: "synced", ...(await syncProject(projectId)) };
  } catch (error) {
    if (error instanceof BingNotConnectedError) {
      return { status: "not_connected" };
    }
    throw error;
  }
}

export const BingSyncService = {
  syncProject,
  runScheduledSyncs,
  syncNow,
};
