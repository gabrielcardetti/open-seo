/**
 * The indexing monitor's schedule: for every project with a Search Console
 * property, keep the list of URLs its sitemaps publish and inspect them with
 * the URL Inspection API, a batch per five-minute tick, within a daily
 * budget under Google's quota (2,000 inspections a day and 600 a minute per
 * property). New URLs go first, then URLs not indexed yet, then indexed ones
 * due a weekly recheck.
 */
import { collectSitemapEntries } from "@/server/lib/audit/discovery";
import { AppError } from "@/server/lib/errors";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { SitemapRegistryService } from "@/server/features/sitemaps/SitemapRegistryService";
import { insideProperty } from "@/server/features/sitemaps/searchConsoleProperty";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { UrlInspectionRepository } from "@/server/features/gsc/repositories/UrlInspectionRepository";
import {
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { DAILY_INSPECTION_BUDGET } from "@/server/features/gsc/services/UrlInspectionService";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Projects one tick may run, and how long it may keep starting new ones. */
const PROJECTS_PER_TICK = 3;
const TICK_DEADLINE_MS = 2 * MINUTE_MS;
/** URLs one run inspects: about half a minute at five in flight. */
const INSPECTIONS_PER_RUN = 100;
/** A claimed run that dies is retried after this. */
const CLAIM_LEASE_MS = 30 * MINUTE_MS;
/** How often the URL list is read again from the sitemaps. */
const URL_REFRESH_MS = DAY_MS;
const RECHECK_NOT_INDEXED_MS = DAY_MS;
const RECHECK_INDEXED_MS = 7 * DAY_MS;
/** With nothing due, look again after this (new URLs arrive daily). */
const IDLE_MS = 6 * HOUR_MS;
const RATE_LIMITED_MS = HOUR_MS;
/** At 1,500 a day, about a week's worth of rechecks. */
const MAX_MONITORED_URLS = 10_000;

const RECONNECT =
  "The Search Console connection has expired or was revoked. Reconnect Search Console.";

function startOfNextUtcDay(nowMs: number): string {
  const next = new Date(nowMs);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

/**
 * Read the URLs the project's sitemaps list now (its tracked sitemaps, or
 * robots.txt and /sitemap.xml while none are tracked), keep those inside the
 * Search Console property, and mark them monitored. URLs that left the
 * sitemaps stop being monitored, unless a sitemap could not be read.
 * Returns what went wrong, or null.
 */
async function refreshUrls(
  projectId: string,
  siteUrl: string,
  nowIso: string,
): Promise<string | null> {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project?.domain) {
    return "This project has no website domain. Set one in the project settings.";
  }
  let collected;
  try {
    collected = await collectSitemapEntries(
      project.domain,
      await SitemapRegistryService.trackedUrls(projectId),
    );
  } catch (error) {
    return error instanceof AppError && error.code === "CRAWL_TARGET_BLOCKED"
      ? "The project's domain points at an address OpenSEO is not allowed to fetch."
      : "Could not read the project's sitemaps.";
  }
  const entries = collected.entries
    .filter((entry) => insideProperty(siteUrl, entry.url))
    .slice(0, MAX_MONITORED_URLS);
  const complete = collected.failedSitemaps.length === 0;
  if (entries.length === 0) {
    return complete
      ? `No sitemap URLs inside the Search Console property ${siteUrl}.`
      : `Could not read ${collected.failedSitemaps[0]} just now.`;
  }
  await UrlInspectionRepository.syncSitemapUrls({
    projectId,
    entries,
    removeMissing: complete,
    nowIso,
  });
  return complete
    ? null
    : `Could not read ${collected.failedSitemaps[0]} just now; its URLs are kept as they were.`;
}

/** One project's run. Returns when the next run should start. */
async function runProject(projectId: string): Promise<string> {
  const startedMs = Date.now();
  const nowIso = new Date(startedMs).toISOString();
  const connection = await GscConnectionRepository.getByProjectId(projectId);
  if (!connection) return new Date(startedMs + DAY_MS).toISOString();
  const monitor = await UrlInspectionRepository.getMonitor(projectId);

  let refreshProblem: string | null = null;
  const refreshedMs = Date.parse(monitor?.urlsRefreshedAt ?? "");
  if (
    !Number.isFinite(refreshedMs) ||
    startedMs - refreshedMs >= URL_REFRESH_MS
  ) {
    refreshProblem = await refreshUrls(projectId, connection.siteUrl, nowIso);
    await UrlInspectionRepository.updateMonitor(
      projectId,
      { urlsRefreshedAt: nowIso },
      nowIso,
    );
  }

  const usedToday =
    monitor?.budgetDay === nowIso.slice(0, 10) ? monitor.inspectionsToday : 0;
  const budget = Math.min(
    INSPECTIONS_PER_RUN,
    DAILY_INSPECTION_BUDGET - usedToday,
  );
  const finish = async (next: string, problem: string | null) => {
    await UrlInspectionRepository.updateMonitor(
      projectId,
      {
        lastRunAt: nowIso,
        lastError: problem ?? refreshProblem,
        nextRunAt: next,
      },
      new Date().toISOString(),
    );
    return next;
  };
  if (budget <= 0) return finish(startOfNextUtcDay(startedMs), null);

  const due = await UrlInspectionRepository.pickDue({
    projectId,
    limit: budget,
    notIndexedBefore: new Date(
      startedMs - RECHECK_NOT_INDEXED_MS,
    ).toISOString(),
    indexedBefore: new Date(startedMs - RECHECK_INDEXED_MS).toISOString(),
  });
  if (due.length === 0) {
    return finish(new Date(startedMs + IDLE_MS).toISOString(), null);
  }
  try {
    const { results } = await GscService.inspectUrls({ projectId, urls: due });
    if (results.some((result) => result.status === 429)) {
      return finish(
        new Date(Date.now() + RATE_LIMITED_MS).toISOString(),
        "Search Console rate limit reached; the monitor resumes in an hour.",
      );
    }
  } catch (error) {
    if (!isExpectedGrantFailure(error)) throw error;
    return finish(new Date(startedMs + DAY_MS).toISOString(), RECONNECT);
  }
  // A full batch likely left more due: carry on at the next tick.
  return finish(
    due.length === budget
      ? new Date().toISOString()
      : new Date(startedMs + IDLE_MS).toISOString(),
    null,
  );
}

/**
 * Monitor runs driven by the five-minute cron. Each due project is claimed
 * with a compare-and-set that leases it for half an hour, so overlapping
 * ticks never run one project twice and a run that dies is retried. Never
 * throws: one cron job must not stop the others.
 */
async function runScheduledInspections() {
  const startedAt = Date.now();
  const tally = { ran: 0, failed: 0 };
  try {
    const nowIso = new Date(startedAt).toISOString();
    const due = await UrlInspectionRepository.getDueMonitors(
      nowIso,
      PROJECTS_PER_TICK,
    );
    for (const project of due) {
      if (Date.now() - startedAt > TICK_DEADLINE_MS) break;
      await UrlInspectionRepository.ensureMonitor(project.projectId, nowIso);
      const claimed = await UrlInspectionRepository.claimRun({
        projectId: project.projectId,
        observed: project.nextRunAt,
        next: new Date(startedAt + CLAIM_LEASE_MS).toISOString(),
      });
      if (!claimed) continue;
      try {
        await runProject(project.projectId);
        tally.ran += 1;
      } catch (error) {
        tally.failed += 1;
        console.error("Scheduled URL inspection run failed", {
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (due.length > 0) {
      console.log("Scheduled URL inspection tick", {
        due: due.length,
        ...tally,
      });
    }
  } catch (error) {
    console.error("Scheduled URL inspection tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return tally;
}

export const IndexingMonitorService = {
  runScheduledInspections,
};
