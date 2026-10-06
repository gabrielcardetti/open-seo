/**
 * The indexing monitor's records: every URL Inspection result is kept as the
 * URL's latest state, with a history row only when its coverage state,
 * Google's canonical or its indexed verdict changed. The status read turns
 * them into a summary per coverage state and per URL template, a daily trend
 * and a list of problems.
 */
import { sortBy } from "remeda";
import type { UrlInspectionResult } from "@/server/lib/gscClient";
import { urlTemplateOf } from "@/server/lib/audit/url-utils";
import {
  INDEXED_VERDICT,
  UrlInspectionRepository,
  type LatestInspection,
  type UrlInspectionRow,
} from "@/server/features/gsc/repositories/UrlInspectionRepository";
import {
  INDEXING_PROBLEM_KINDS,
  type IndexingProblemKind,
} from "@/shared/indexing";
import type { IndexingStatusFilters } from "@/types/schemas/indexing";

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 90;
const MAX_TEMPLATES = 50;

/** Google's daily URL Inspection quota is 2,000 per property; the monitor
 *  stays under it so manual inspections still have room. */
export const DAILY_INSPECTION_BUDGET = 1_500;

type InspectionOutcome = {
  url: string;
  result: UrlInspectionResult | null;
  error?: string;
};

const utcDay = (iso: string) => iso.slice(0, 10);

const isIndexed = (row: { verdict: string | null }) =>
  row.verdict === INDEXED_VERDICT;

/** Google has answered for this URL at least once. */
const wasInspected = (row: UrlInspectionRow) =>
  row.verdict !== null || row.coverageState !== null;

type IndexStatus = NonNullable<UrlInspectionResult["indexStatusResult"]>;

function latestFrom(
  answer: IndexStatus,
  before: UrlInspectionRow | undefined,
  nowIso: string,
): LatestInspection {
  return {
    verdict: answer.verdict ?? null,
    coverageState: answer.coverageState ?? null,
    indexingState: answer.indexingState ?? null,
    robotsTxtState: answer.robotsTxtState ?? null,
    pageFetchState: answer.pageFetchState ?? null,
    lastCrawlTime: answer.lastCrawlTime ?? null,
    googleCanonical: answer.googleCanonical ?? null,
    userCanonical: answer.userCanonical ?? null,
    lastError: null,
    lastInspectedAt: nowIso,
    firstIndexedAt:
      before?.firstIndexedAt ??
      (answer.verdict === INDEXED_VERDICT ? nowIso : null),
  };
}

/**
 * Store one batch of inspection outcomes for a project and count them
 * against the property's daily quota. A failed inspection keeps the URL's
 * last known state and records why it failed.
 */
async function record(projectId: string, outcomes: InspectionOutcome[]) {
  if (outcomes.length === 0) return;
  const nowIso = new Date().toISOString();
  const previous = new Map(
    (
      await UrlInspectionRepository.getByUrls(
        projectId,
        outcomes.map((outcome) => outcome.url),
      )
    ).map((row) => [row.url, row]),
  );
  const rows = [];
  const changes = [];
  for (const outcome of outcomes) {
    const before = previous.get(outcome.url);
    const firstSeenAt = before?.firstSeenAt ?? nowIso;
    const answer = outcome.result?.indexStatusResult;
    if (!answer) {
      const lastError =
        outcome.error ?? "Search Console returned no index status.";
      rows.push({
        url: outcome.url,
        firstSeenAt,
        latest: { lastError, lastInspectedAt: nowIso },
      });
      continue;
    }
    const latest = latestFrom(answer, before, nowIso);
    rows.push({ url: outcome.url, firstSeenAt, latest });
    // A URL whose earlier inspections all failed has no state to compare.
    const known = before && wasInspected(before) ? before : null;
    if (
      !known ||
      known.coverageState !== latest.coverageState ||
      known.googleCanonical !== latest.googleCanonical ||
      isIndexed(known) !== isIndexed(latest)
    ) {
      changes.push({
        url: outcome.url,
        inspectedAt: nowIso,
        coverageState: latest.coverageState,
        googleCanonical: latest.googleCanonical,
        indexed: isIndexed(latest),
        previousIndexed: known ? isIndexed(known) : null,
      });
    }
  }
  await UrlInspectionRepository.saveInspections({ projectId, rows, changes });
  await UrlInspectionRepository.addInspections(
    projectId,
    outcomes.length,
    utcDay(nowIso),
    nowIso,
  );
}

const NOINDEX_STATES = new Set([
  "BLOCKED_BY_META_TAG",
  "BLOCKED_BY_HTTP_HEADER",
]);
const FETCH_OK_STATES = new Set(["SUCCESSFUL", "PAGE_FETCH_STATE_UNSPECIFIED"]);

/** The problems a monitored URL shows, most serious first. */
function problemsOf(
  row: UrlInspectionRow,
  notIndexedSinceIso: string,
): IndexingProblemKind[] {
  const inspected = wasInspected(row);
  const kinds: IndexingProblemKind[] = [];
  if (inspected && row.firstIndexedAt && !isIndexed(row)) {
    kinds.push("lost_indexing");
  }
  if (row.indexingState && NOINDEX_STATES.has(row.indexingState)) {
    kinds.push("noindex");
  }
  if (row.pageFetchState && !FETCH_OK_STATES.has(row.pageFetchState)) {
    kinds.push("fetch_error");
  }
  if (
    row.googleCanonical &&
    row.userCanonical &&
    row.googleCanonical !== row.userCanonical
  ) {
    kinds.push("canonical_mismatch");
  }
  if (inspected && !isIndexed(row) && row.firstSeenAt <= notIndexedSinceIso) {
    kinds.push("not_indexed_after_days");
  }
  if (!inspected && row.lastError) kinds.push("inspection_failed");
  return kinds;
}

type UrlStatus = "indexed" | "not_indexed" | "not_inspected";

function statusOf(row: UrlInspectionRow): UrlStatus {
  if (!wasInspected(row)) return "not_inspected";
  return isIndexed(row) ? "indexed" : "not_indexed";
}

function stateLabel(row: UrlInspectionRow): string {
  if (row.coverageState) return row.coverageState;
  return row.lastError ? "Inspection failed" : "Not inspected yet";
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function matches(row: UrlInspectionRow, filters: IndexingStatusFilters) {
  if (filters.template && urlTemplateOf(row.url) !== filters.template) {
    return false;
  }
  if (filters.pathPrefix && !pathOf(row.url).startsWith(filters.pathPrefix)) {
    return false;
  }
  if (filters.status && statusOf(row) !== filters.status) return false;
  return (
    !filters.coverageState ||
    stateLabel(row).toLowerCase().includes(filters.coverageState.toLowerCase())
  );
}

const side = (indexed: boolean) => (indexed ? "indexed" : "notIndexed");

/** Count each key, largest first. */
function tally<T>(rows: T[], keyOf: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortBy([...counts], [([, value]) => value, "desc"]);
}

/**
 * Indexed and not-indexed counts per UTC day over the last TREND_DAYS,
 * replayed from the change history of the URLs monitored now.
 */
async function trend(projectId: string, nowMs: number) {
  const rows = await UrlInspectionRepository.dailyChanges(projectId);
  const firstDay = rows[0]?.day;
  if (!firstDay) return [];
  const startDay = utcDay(
    new Date(
      Math.max(Date.parse(firstDay), nowMs - (TREND_DAYS - 1) * DAY_MS),
    ).toISOString(),
  );
  // Each change adds its URL to its new side and takes it off its old one.
  let current = { indexed: 0, notIndexed: 0 };
  const byDay = new Map<string, typeof current>();
  for (const row of rows) {
    current = { ...current };
    current[side(row.indexed)] += row.changes;
    if (row.previousIndexed !== null) {
      current[side(row.previousIndexed)] -= row.changes;
    }
    byDay.set(row.day < startDay ? startDay : row.day, current);
  }
  const points = [];
  let counts = { indexed: 0, notIndexed: 0 };
  for (let ms = Date.parse(startDay); ms <= nowMs; ms += DAY_MS) {
    const date = utcDay(new Date(ms).toISOString());
    counts = byDay.get(date) ?? counts;
    points.push({ date, ...counts });
  }
  return points;
}

/**
 * The project's indexing status: totals, counts per coverage state and per
 * URL template, the daily trend, and the URLs with problems. Filters narrow
 * everything but the trend, which always covers every monitored URL.
 */
async function status(projectId: string, filters: IndexingStatusFilters) {
  const nowMs = Date.now();
  const [monitor, all, trendPoints] = await Promise.all([
    UrlInspectionRepository.getMonitor(projectId),
    UrlInspectionRepository.listMonitored(projectId),
    trend(projectId, nowMs),
  ]);
  const rows = all.filter((row) => matches(row, filters));
  const notIndexedSince = new Date(
    nowMs - filters.notIndexedDays * DAY_MS,
  ).toISOString();
  const withProblems = rows.flatMap((row) => {
    const kinds = problemsOf(row, notIndexedSince).filter(
      (kind) => !filters.problem || kind === filters.problem,
    );
    return kinds.length > 0 ? [{ row, kinds }] : [];
  });
  const problemCounts = Object.fromEntries(
    INDEXING_PROBLEM_KINDS.map((kind) => [
      kind,
      withProblems.filter((entry) => entry.kinds.includes(kind)).length,
    ]),
  );
  const sortedProblems = sortBy(
    withProblems,
    (entry) =>
      INDEXING_PROBLEM_KINDS.indexOf(entry.kinds[0] ?? "inspection_failed"),
    (entry) => entry.row.firstSeenAt,
  );
  const templates = tally(rows, (row) => urlTemplateOf(row.url));
  const count = (wanted: UrlStatus, list: UrlInspectionRow[]) =>
    list.filter((row) => statusOf(row) === wanted).length;

  return {
    monitor: {
      lastRunAt: monitor?.lastRunAt ?? null,
      urlsRefreshedAt: monitor?.urlsRefreshedAt ?? null,
      lastError: monitor?.lastError ?? null,
      inspectionsToday:
        monitor?.budgetDay === utcDay(new Date(nowMs).toISOString())
          ? monitor.inspectionsToday
          : 0,
      dailyBudget: DAILY_INSPECTION_BUDGET,
    },
    totals: {
      monitored: all.length,
      matching: rows.length,
      indexed: count("indexed", rows),
      notIndexed: count("not_indexed", rows),
      notInspected: count("not_inspected", rows),
    },
    byState: tally(rows, stateLabel).map(([state, urls]) => ({ state, urls })),
    byTemplate: templates.slice(0, MAX_TEMPLATES).map(([template]) => {
      const inTemplate = rows.filter(
        (row) => urlTemplateOf(row.url) === template,
      );
      return {
        template,
        urls: inTemplate.length,
        indexed: count("indexed", inTemplate),
        notIndexed: count("not_indexed", inTemplate),
        notInspected: count("not_inspected", inTemplate),
      };
    }),
    templatesTruncated: templates.length > MAX_TEMPLATES,
    trend: trendPoints,
    problemCounts,
    problemTotal: sortedProblems.length,
    problems: sortedProblems.slice(0, filters.limit).map(({ row, kinds }) => ({
      url: row.url,
      kinds,
      template: urlTemplateOf(row.url),
      coverageState: row.coverageState,
      indexingState: row.indexingState,
      pageFetchState: row.pageFetchState,
      googleCanonical: row.googleCanonical,
      userCanonical: row.userCanonical,
      lastCrawlTime: row.lastCrawlTime,
      lastError: row.lastError,
      sitemapUrl: row.sitemapUrl,
      firstSeenAt: row.firstSeenAt,
      firstIndexedAt: row.firstIndexedAt,
      lastInspectedAt: row.lastInspectedAt,
    })),
  };
}

export type IndexingStatus = Awaited<ReturnType<typeof status>>;

export const UrlInspectionService = {
  record,
  status,
};
