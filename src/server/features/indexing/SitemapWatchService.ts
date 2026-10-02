/**
 * The sitemap watch: keep an inventory of every URL the project's sitemaps
 * list, and announce the ones that are new or whose `<lastmod>` moved.
 *
 * The first inventory of a project is a baseline: everything is recorded and
 * nothing is submitted, so connecting a site never blasts thousands of URLs
 * that search engines already know.
 */
import { collectSitemapEntries } from "@/server/lib/audit/discovery";
import { AppError } from "@/server/lib/errors";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import type { UrlSubmissionSource } from "@/shared/indexing";
import { IndexingRepository } from "./IndexingRepository";
import {
  UrlSubmissionService,
  type SubmissionResult,
} from "./UrlSubmissionService";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKS_PER_TICK = 3;
const TICK_DEADLINE_MS = 3 * 60 * 1000;

type StoredUrl = {
  url: string;
  lastmod: string | null;
  removedAt: string | null;
};
type Entry = { url: string; lastmod: string | null };

type SitemapDiff = {
  /** True when the project had no inventory yet: recorded, not submitted. */
  baseline: boolean;
  origin: string;
  totalUrls: number;
  /** The walk stopped at its URL cap; URLs past it are neither new nor removed. */
  truncated: boolean;
  newUrls: string[];
  changedUrls: string[];
  removedUrls: string[];
};

type CheckOutcome =
  | { ok: false; problem: string }
  | { ok: true; diff: SitemapDiff; submission: SubmissionResult | null };

/** `next` is a later date than `previous`. Unparseable or missing never is. */
function isNewer(next: string | null, previous: string | null): boolean {
  if (!next || !previous) return false;
  const nextMs = Date.parse(next);
  const previousMs = Date.parse(previous);
  return (
    Number.isFinite(nextMs) &&
    Number.isFinite(previousMs) &&
    nextMs > previousMs
  );
}

function computeDiff(stored: StoredUrl[], entries: Entry[]) {
  const byUrl = new Map(stored.map((row) => [row.url, row]));
  const seen = new Set(entries.map((entry) => entry.url));
  const inserted: Entry[] = [];
  const updated: Entry[] = [];
  const changedUrls: string[] = [];
  for (const entry of entries) {
    const row = byUrl.get(entry.url);
    if (!row) {
      inserted.push(entry);
      continue;
    }
    const changed = isNewer(entry.lastmod, row.lastmod);
    if (changed) changedUrls.push(entry.url);
    // A URL coming back is recorded but not re-announced on that alone: a
    // shard that failed to load yesterday is not news.
    if (changed || row.removedAt || (entry.lastmod && !row.lastmod)) {
      updated.push(entry);
    }
  }
  const removedUrls = stored
    .filter((row) => !row.removedAt && !seen.has(row.url))
    .map((row) => row.url);
  return { inserted, updated, changedUrls, removedUrls };
}

/** Fetch the sitemaps and diff them against the stored inventory. */
async function diffSitemaps(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project?.domain) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This project has no website domain. Set one in the project settings.",
    );
  }
  const [collected, stored] = await Promise.all([
    collectSitemapEntries(project.domain),
    IndexingRepository.listSitemapUrls(projectId),
  ]);
  const changes = computeDiff(stored, collected.entries);
  // Past the walk's cap the inventory is partial: don't read the rest as removed.
  const removedUrls = collected.truncated ? [] : changes.removedUrls;
  const baseline = stored.length === 0;
  const diff: SitemapDiff = {
    baseline,
    origin: collected.origin,
    totalUrls: collected.entries.length,
    truncated: collected.truncated,
    newUrls: changes.inserted.map((entry) => entry.url),
    changedUrls: changes.changedUrls,
    removedUrls,
  };
  return { diff, changes: { ...changes, removedUrls }, collected };
}

/**
 * The live diff without recording or submitting anything: what the next
 * check would announce. Sitemaps are fetched now, so it reflects the site
 * as it is, not as it was at the last check.
 */
async function previewCandidates(projectId: string): Promise<CheckOutcome> {
  try {
    const { diff, collected } = await diffSitemaps(projectId);
    if (collected.entries.length === 0) {
      return { ok: false, problem: noSitemapProblem(diff.origin) };
    }
    return { ok: true, diff, submission: null };
  } catch (error) {
    return { ok: false, problem: describeError(error) };
  }
}

const noSitemapProblem = (origin: string) =>
  `No sitemap URLs found for ${origin}. List your sitemap in robots.txt or serve it at /sitemap.xml.`;

function describeError(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === "CRAWL_TARGET_BLOCKED") {
      return "The project's domain points at an address OpenSEO is not allowed to fetch.";
    }
    return error.message === error.code
      ? "The project's domain is not a valid website."
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch the sitemaps, record the inventory, and submit the new and changed
 * URLs. A baseline records without submitting. An empty sitemap read leaves
 * the inventory untouched (the site was down, not emptied).
 */
async function runSitemapCheck(
  projectId: string,
  source: UrlSubmissionSource,
): Promise<CheckOutcome> {
  let outcome: CheckOutcome;
  try {
    outcome = await checkAndSubmit(projectId, source);
  } catch (error) {
    outcome = { ok: false, problem: describeError(error) };
  }
  await IndexingRepository.recordSitemapCheck(
    projectId,
    outcome.ok ? (outcome.submission?.problem ?? null) : outcome.problem,
  );
  return outcome;
}

async function checkAndSubmit(
  projectId: string,
  source: UrlSubmissionSource,
): Promise<CheckOutcome> {
  const { diff, changes, collected } = await diffSitemaps(projectId);
  if (collected.entries.length === 0) {
    return { ok: false, problem: noSitemapProblem(diff.origin) };
  }
  const settings = await IndexingRepository.getSettings(projectId);
  const toSubmit = [...diff.newUrls, ...diff.changedUrls];
  if (!diff.baseline && toSubmit.length > 0) {
    const channel = await UrlSubmissionService.resolveAutoChannel(
      projectId,
      settings,
    );
    // Without a channel, keep the inventory as it was so these URLs are
    // still new or changed once IndexNow or Bing is set up.
    if (!channel) {
      return {
        ok: false,
        problem:
          "Found new or changed URLs but nothing to send them with: set up IndexNow or connect Bing Webmaster Tools.",
      };
    }
  }
  await IndexingRepository.applySitemapInventory({
    projectId,
    nowIso: new Date().toISOString(),
    inserted: changes.inserted,
    updated: changes.updated,
    removed: changes.removedUrls,
  });
  const submission =
    diff.baseline || toSubmit.length === 0
      ? null
      : await UrlSubmissionService.submitUrls(projectId, toSubmit, source);
  return { ok: true, diff, submission };
}

/**
 * Daily sitemap checks for projects with auto-submit on, driven by the
 * five-minute cron. Each due project is claimed with a compare-and-set that
 * also advances it a day, so overlapping ticks never check one project twice
 * and a failing site is retried tomorrow, not every five minutes. Never throws.
 */
async function runScheduledSitemapChecks() {
  const startedAt = Date.now();
  const tally = { ran: 0, failed: 0 };
  try {
    const due = await IndexingRepository.getDueSitemapChecks(
      new Date(startedAt).toISOString(),
      CHECKS_PER_TICK,
    );
    for (const project of due) {
      if (Date.now() - startedAt > TICK_DEADLINE_MS) break;
      const claimed = await IndexingRepository.claimSitemapCheck({
        projectId: project.projectId,
        observed: project.nextSitemapCheckAt,
        next: new Date(startedAt + DAY_MS).toISOString(),
      });
      if (!claimed) continue;
      const outcome = await runSitemapCheck(project.projectId, "sitemap");
      if (outcome.ok) tally.ran += 1;
      else tally.failed += 1;
    }
    if (due.length > 0) {
      console.log("Scheduled sitemap indexing tick", {
        due: due.length,
        ...tally,
      });
    }
  } catch (error) {
    console.error("Scheduled sitemap indexing tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return tally;
}

export const SitemapWatchService = {
  previewCandidates,
  runSitemapCheck,
  runScheduledSitemapChecks,
} as const;
