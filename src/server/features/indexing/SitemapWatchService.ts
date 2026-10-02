/**
 * The sitemap watch: keep an inventory of every URL the project's sitemaps
 * list, and announce the ones that are new or whose `<lastmod>` moved. The
 * sitemaps are the project's tracked ones, or, while none are tracked, the
 * ones robots.txt names plus /sitemap.xml.
 *
 * The first inventory of a project is a baseline: everything is recorded and
 * nothing is submitted, so connecting a site never blasts thousands of URLs
 * that search engines already know.
 *
 * A URL's inventory row only moves forward (inserted, or its new lastmod
 * stored) once its announcement got an answer that resending would not
 * change. Failed, throttled and over-quota sends, and those IndexNow refused
 * for a key file problem, leave it new or changed for the next check.
 */
import { collectSitemapEntries } from "@/server/lib/audit/discovery";
import { AppError } from "@/server/lib/errors";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { SitemapRegistryService } from "@/server/features/sitemaps/SitemapRegistryService";
import type { UrlSubmissionSource } from "@/shared/indexing";
import { IndexingRepository } from "./IndexingRepository";
import {
  UrlSubmissionService,
  type SubmissionResult,
} from "./UrlSubmissionService";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKS_PER_TICK = 3;
const TICK_DEADLINE_MS = 3 * 60 * 1000;
/** Changed URLs one check sends at most; the rest stay changed for the next. */
const MAX_CHANGED_PER_CHECK = 500;

/**
 * Some sitemaps stamp every URL with the time they were generated (Next.js
 * `lastModified: new Date()`, many CMS plugins), so every URL looks changed
 * on every check. A check reads its lastmods as unreliable when at least
 * UNRELIABLE_LASTMOD_MIN_URLS URLs carry a lastmod in both the stored and the
 * new inventory, and at least 90% of them moved forward to within 36 hours of
 * now. 36 hours, not 24, so a date-only lastmod written in any time zone
 * still counts. Such a check sends only new URLs.
 */
const UNRELIABLE_LASTMOD_MIN_URLS = 10;
const UNRELIABLE_LASTMOD_SHARE = 0.9;
const FRESH_LASTMOD_MS = 36 * 60 * 60 * 1000;

const UNRELIABLE_LASTMOD_WARNING =
  "Your sitemap gives nearly every URL a <lastmod> of right now, so it can't tell which pages changed. Only new URLs are sent. Set <lastmod> to when each page's content last changed to have changed pages sent too.";

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
  /** The walk stopped at a cap; URLs past it are neither new nor removed. */
  truncated: boolean;
  /** The lastmods look stamped at generation time; `changedUrls` is empty. */
  lastmodUnreliable: boolean;
  newUrls: string[];
  /** Every changed URL; one check sends the first MAX_CHANGED_PER_CHECK. */
  changedUrls: string[];
  removedUrls: string[];
};

type CheckOutcome =
  | { ok: false; problem: string }
  | {
      ok: true;
      diff: SitemapDiff;
      submission: SubmissionResult | null;
      /** Something the user should fix, though the check went through. */
      warning: string | null;
    };

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

function computeDiff(stored: StoredUrl[], entries: Entry[], nowMs: number) {
  const byUrl = new Map(stored.map((row) => [row.url, row]));
  const seen = new Set(entries.map((entry) => entry.url));
  const inserted: Entry[] = [];
  const updated: Array<{ entry: Entry; row: StoredUrl; changed: boolean }> = [];
  const changedUrls: string[] = [];
  let comparable = 0;
  let movedToNow = 0;
  for (const entry of entries) {
    const row = byUrl.get(entry.url);
    if (!row) {
      inserted.push(entry);
      continue;
    }
    if (entry.lastmod && row.lastmod) comparable += 1;
    const changed = isNewer(entry.lastmod, row.lastmod);
    if (changed) {
      changedUrls.push(entry.url);
      const lastmodMs = Date.parse(entry.lastmod ?? "");
      if (Math.abs(nowMs - lastmodMs) <= FRESH_LASTMOD_MS) movedToNow += 1;
    }
    // A URL coming back is recorded but not re-announced on that alone: a
    // shard that failed to load yesterday is not news.
    if (changed || row.removedAt || (entry.lastmod && !row.lastmod)) {
      updated.push({ entry, row, changed });
    }
  }
  const removedUrls = stored
    .filter((row) => !row.removedAt && !seen.has(row.url))
    .map((row) => row.url);
  const lastmodUnreliable =
    comparable >= UNRELIABLE_LASTMOD_MIN_URLS &&
    movedToNow >= comparable * UNRELIABLE_LASTMOD_SHARE;
  return {
    inserted,
    updated,
    changedUrls: lastmodUnreliable ? [] : changedUrls,
    removedUrls,
    lastmodUnreliable,
  };
}

/** Fetch the sitemaps and diff them against the stored inventory. */
async function diffSitemaps(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project) {
    throw new AppError(
      "NOT_FOUND",
      "This project is archived or no longer exists.",
    );
  }
  if (!project.domain) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This project has no website domain. Set one in the project settings.",
    );
  }
  const [tracked, stored] = await Promise.all([
    SitemapRegistryService.trackedUrls(projectId),
    IndexingRepository.listSitemapUrls(projectId),
  ]);
  const collected = await collectSitemapEntries(project.domain, tracked);
  const changes = computeDiff(stored, collected.entries, Date.now());
  // Past the walk's cap the inventory is partial: don't read the rest as removed.
  const removedUrls = collected.truncated ? [] : changes.removedUrls;
  const diff: SitemapDiff = {
    baseline: stored.length === 0,
    origin: collected.origin,
    totalUrls: collected.entries.length,
    truncated: collected.truncated,
    lastmodUnreliable: changes.lastmodUnreliable,
    newUrls: changes.inserted.map((entry) => entry.url),
    changedUrls: changes.changedUrls,
    removedUrls,
  };
  return {
    diff,
    changes: { ...changes, removedUrls },
    problem: readProblem(collected),
  };
}

/**
 * Why this sitemap read can't be used. A read that missed a document would
 * make the URLs it lists look removed now and new again later, so it is
 * neither recorded nor submitted; the next check reads everything again.
 */
function readProblem(collected: {
  origin: string;
  entries: unknown[];
  failedSitemaps: string[];
}): string | null {
  const [failed, ...others] = collected.failedSitemaps;
  if (failed) {
    const more = others.length > 0 ? ` and ${others.length} more` : "";
    return `Could not read ${failed}${more} just now (timeout or server error), so this check recorded and sent nothing. The next check tries again.`;
  }
  if (collected.entries.length === 0) {
    return `No sitemap URLs found for ${collected.origin}. List your sitemap in robots.txt or serve it at /sitemap.xml.`;
  }
  return null;
}

/**
 * The live diff without recording or submitting anything: what the next
 * check would announce. Sitemaps are fetched now, so it reflects the site
 * as it is, not as it was at the last check.
 */
async function previewCandidates(projectId: string): Promise<CheckOutcome> {
  try {
    const { diff, problem } = await diffSitemaps(projectId);
    if (problem) return { ok: false, problem };
    return {
      ok: true,
      diff,
      submission: null,
      warning: diff.lastmodUnreliable ? UNRELIABLE_LASTMOD_WARNING : null,
    };
  } catch (error) {
    return { ok: false, problem: describeError(error) };
  }
}

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
 * Fetch the sitemaps, submit the new and changed URLs, and record the
 * inventory. A baseline records without submitting. A sitemap read that came
 * back empty or missed a document leaves the inventory untouched.
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
    outcome.ok
      ? (outcome.submission?.problem ?? outcome.warning)
      : outcome.problem,
  );
  return outcome;
}

/**
 * Outcomes a later check should send again: the engine never answered, was
 * throttling, the Bing quota ran out, or IndexNow could not read the key file
 * (fixing the file makes the same URLs go through).
 */
function needsResend(row: SubmissionResult["results"][number]): boolean {
  return (
    row.status === "failed" ||
    row.status === "throttled" ||
    row.status === "skipped_quota" ||
    (row.status === "rejected" && row.httpStatus === 403)
  );
}

/** URLs whose announcement is done: answered, recently sent, or unsendable. */
function settledUrls(submission: SubmissionResult | null): Set<string> {
  const settled = new Set<string>();
  for (const row of submission?.results ?? []) {
    if (!needsResend(row)) settled.add(row.url);
  }
  // Not on the project's site: no later check could send these either.
  for (const { url } of submission?.dropped ?? []) settled.add(url);
  return settled;
}

async function checkAndSubmit(
  projectId: string,
  source: UrlSubmissionSource,
): Promise<CheckOutcome> {
  const { diff, changes, problem } = await diffSitemaps(projectId);
  if (problem) return { ok: false, problem };
  const toSubmit = [
    ...diff.newUrls,
    ...diff.changedUrls.slice(0, MAX_CHANGED_PER_CHECK),
  ];
  const submission =
    diff.baseline || toSubmit.length === 0
      ? null
      : await UrlSubmissionService.submitUrls(projectId, toSubmit, source);
  const settled = settledUrls(submission);
  const isSettled = (url: string) => diff.baseline || settled.has(url);
  await IndexingRepository.applySitemapInventory({
    projectId,
    nowIso: new Date().toISOString(),
    inserted: changes.inserted.filter((entry) => isSettled(entry.url)),
    updated: changes.updated.flatMap(({ entry, row, changed }) => {
      if (!changed || isSettled(entry.url)) return [entry];
      // Keep the old lastmod so the URL is still changed next time.
      return row.removedAt ? [{ url: entry.url, lastmod: row.lastmod }] : [];
    }),
    removed: changes.removedUrls,
  });
  return {
    ok: true,
    diff,
    submission,
    warning: diff.lastmodUnreliable ? UNRELIABLE_LASTMOD_WARNING : null,
  };
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
