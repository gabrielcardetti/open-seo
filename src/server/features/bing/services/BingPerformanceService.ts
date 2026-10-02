import { sort } from "remeda";
import { openBingClientForProject } from "@/server/features/bing/bingAccess";
import {
  addDays,
  aggregateBuckets,
  ctr,
  resolveRange,
  type DateRangeInput,
} from "@/server/features/bing/bingStats";
import { pageJoinKey } from "@/server/features/bing/bingUrls";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import {
  BingSnapshotRepository,
  type BingAggregatedRow,
  type BingStatsDimension,
  type BingStatsSort,
} from "@/server/features/bing/repositories/BingSnapshotRepository";
import { previousPeriod } from "@/server/features/gsc/searchPerformanceReport";
import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";

const DEFAULT_RANGE_DAYS = 28;
const STRIKING_DISTANCE_LIMIT = 50;
const COMPARE_FETCH_LIMIT = 1000;

type NotConnected = { connected: false };

/** Rows with CTR, for every table the app and agents read. */
export type BingPerformanceRow = BingAggregatedRow & { ctr: number };

function withCtr(row: BingAggregatedRow): BingPerformanceRow {
  return { ...row, ctr: ctr(row.clicks, row.impressions) };
}

async function getScope(projectId: string) {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  return connection ? { projectId, siteUrl: connection.siteUrl } : null;
}

function sumTraffic(days: Array<{ clicks: number; impressions: number }>) {
  let clicks = 0;
  let impressions = 0;
  for (const day of days) {
    clicks += day.clicks;
    impressions += day.impressions;
  }
  return { clicks, impressions, ctr: ctr(clicks, impressions) };
}

/**
 * Site-wide clicks and impressions for a range and the equal-length range
 * before it, from the stored daily history, with the daily series and the
 * striking-distance queries (impression position 5–20) of the same range.
 */
async function summary(
  projectId: string,
  range: DateRangeInput = {},
): Promise<
  | NotConnected
  | {
      connected: true;
      siteUrl: string;
      range: {
        startDate: string;
        endDate: string;
        prevStartDate: string;
        prevEndDate: string;
      };
      totals: { clicks: number; impressions: number; ctr: number };
      prevTotals: { clicks: number; impressions: number; ctr: number };
      daily: Array<{
        date: string;
        clicks: number;
        impressions: number;
        ctr: number;
      }>;
      strikingDistance: BingPerformanceRow[];
    }
> {
  const scope = await getScope(projectId);
  if (!scope) return { connected: false };
  const { startDate, endDate } = resolveRange(
    range,
    await BingSnapshotRepository.getLatestTrafficDate(scope),
    DEFAULT_RANGE_DAYS,
  );
  const prev = previousPeriod(startDate, endDate);
  const [current, previous, striking] = await Promise.all([
    BingSnapshotRepository.getTrafficDays(scope, startDate, endDate),
    BingSnapshotRepository.getTrafficDays(scope, prev.startDate, prev.endDate),
    BingSnapshotRepository.aggregateStats({
      dimension: "query",
      scope,
      startDate,
      endDate,
      minPosition: 5,
      maxPosition: 20,
      sort: "impressions",
      limit: STRIKING_DISTANCE_LIMIT,
      offset: 0,
    }),
  ]);
  return {
    connected: true,
    siteUrl: scope.siteUrl,
    range: {
      startDate,
      endDate,
      prevStartDate: prev.startDate,
      prevEndDate: prev.endDate,
    },
    totals: sumTraffic(current),
    prevTotals: sumTraffic(previous),
    daily: current.map((day) => ({
      ...day,
      ctr: ctr(day.clicks, day.impressions),
    })),
    strikingDistance: striking.rows.map(withCtr),
  };
}

type TableInput = DateRangeInput & {
  dimension: BingStatsDimension;
  search?: string;
  minImpressions?: number;
  minPosition?: number;
  maxPosition?: number;
  sort: BingStatsSort;
  limit: number;
  offset: number;
};

/**
 * Queries or pages over a range of the stored history: Bing's weekly buckets
 * whose date falls in the range, summed per key. Position filters apply to
 * the impression-weighted average position.
 */
async function table(
  projectId: string,
  input: TableInput,
): Promise<
  | NotConnected
  | {
      connected: true;
      siteUrl: string;
      dimension: BingStatsDimension;
      range: { startDate: string; endDate: string };
      rows: BingPerformanceRow[];
      totalCount: number;
    }
> {
  const scope = await getScope(projectId);
  if (!scope) return { connected: false };
  const range = resolveRange(
    input,
    await BingSnapshotRepository.getLatestStatsDate(input.dimension, scope),
    DEFAULT_RANGE_DAYS,
  );
  const { rows, totalCount } = await BingSnapshotRepository.aggregateStats({
    ...input,
    ...range,
    scope,
  });
  return {
    connected: true,
    siteUrl: scope.siteUrl,
    dimension: input.dimension,
    range,
    rows: rows.map(withCtr),
    totalCount,
  };
}

/**
 * Live from Bing (its rolling ~6-month window, not our history): the queries
 * one page ranked for, or the pages that ranked for one query, aggregated the
 * same way as the history tables. With a range, only buckets inside it count.
 * Throws BingNotConnectedError / BingApiError for the caller to classify.
 */
async function drilldown(
  projectId: string,
  input: DateRangeInput & ({ page: string } | { query: string }),
) {
  const { connection, client } = await openBingClientForProject(projectId);
  const buckets =
    "page" in input
      ? (await client.getPageQueryStats(connection.siteUrl, input.page)).map(
          (row) => ({ ...row, key: row.query }),
        )
      : (await client.getQueryPageStats(connection.siteUrl, input.query)).map(
          (row) => ({ ...row, key: row.page }),
        );
  const inRange = buckets.filter(
    (row) =>
      (!input.startDate || row.periodDate >= input.startDate) &&
      (!input.endDate || row.periodDate <= input.endDate),
  );
  return {
    siteUrl: connection.siteUrl,
    dimension: "page" in input ? ("query" as const) : ("page" as const),
    rows: aggregateBuckets(inRange).map(withCtr),
  };
}

type EngineMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

type EngineRow = { bing: EngineMetrics | null; google: EngineMetrics | null };

function bothEngines(row: EngineRow, metric: "clicks" | "impressions") {
  return (row.bing?.[metric] ?? 0) + (row.google?.[metric] ?? 0);
}

/**
 * Bing (stored history) next to Search Console for the same range, joined per
 * query (case-insensitive) or per page (ignoring scheme, `www.` and trailing
 * slash). Without a working Search Console connection it returns Bing alone
 * with a note.
 */
async function compareSearchEngines(
  projectId: string,
  input: DateRangeInput & { dimension: BingStatsDimension; limit: number },
) {
  const scope = await getScope(projectId);
  if (!scope) return { connected: false as const };
  const range = resolveRange(
    input,
    await BingSnapshotRepository.getLatestStatsDate(input.dimension, scope),
    DEFAULT_RANGE_DAYS,
  );
  const bing = await BingSnapshotRepository.aggregateStats({
    dimension: input.dimension,
    scope,
    ...range,
    sort: "clicks",
    limit: COMPARE_FETCH_LIMIT,
    offset: 0,
  });

  let googleRows: Array<{ key: string } & EngineMetrics> | null = null;
  let note: string | null = null;
  try {
    const result = await GscService.getPerformance({
      projectId,
      ...range,
      dimensions: [input.dimension],
      rowLimit: COMPARE_FETCH_LIMIT,
    });
    googleRows = result.rows.flatMap((row) => {
      const key = row.keys?.[0];
      return key
        ? [
            {
              key,
              clicks: row.clicks,
              impressions: row.impressions,
              ctr: row.ctr,
              position: row.position,
            },
          ]
        : [];
    });
  } catch (error) {
    if (
      !(error instanceof GscNotConnectedError) &&
      !isExpectedGrantFailure(error)
    ) {
      throw error;
    }
    note =
      error instanceof GscNotConnectedError
        ? "Search Console isn't connected for this project, so only Bing is shown."
        : "The Search Console connection needs to be reconnected, so only Bing is shown.";
  }

  const joinKey = (key: string) =>
    input.dimension === "page" ? pageJoinKey(key) : key.trim().toLowerCase();
  const merged = new Map<string, EngineRow & { key: string }>();
  for (const row of bing.rows) {
    merged.set(joinKey(row.key), {
      key: row.key,
      bing: {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: ctr(row.clicks, row.impressions),
        position: row.avgImpressionPosition,
      },
      google: null,
    });
  }
  for (const { key, ...metrics } of googleRows ?? []) {
    const existing = merged.get(joinKey(key));
    if (existing) existing.google = metrics;
    else merged.set(joinKey(key), { key, bing: null, google: metrics });
  }
  const rows = sort(
    Array.from(merged.values()),
    (a, b) =>
      bothEngines(b, "clicks") - bothEngines(a, "clicks") ||
      bothEngines(b, "impressions") - bothEngines(a, "impressions"),
  ).slice(0, input.limit);

  return {
    connected: true as const,
    siteUrl: scope.siteUrl,
    dimension: input.dimension,
    range,
    googleConnected: googleRows !== null,
    note,
    rows,
  };
}

/**
 * Bing search volume, live: weekly impressions for each keyword and, for a
 * seed, related keywords over the last 30 days. Uses the project's Bing key
 * but no site data. Unverified against the live API: the parameter formats
 * (country "us", language "en-US", ISO dates) are Bing's documented ones.
 */
async function keywordStats(
  projectId: string,
  input: {
    keywords: string[];
    seed?: string;
    country: string;
    language: string;
  },
) {
  const { client } = await openBingClientForProject(projectId);
  const keywords = await Promise.all(
    input.keywords.map(async (keyword) => {
      const weeks = await client.getKeywordStats(
        keyword,
        input.country,
        input.language,
      );
      return {
        keyword,
        impressions: weeks.reduce((sum, week) => sum + week.impressions, 0),
        broadImpressions: weeks.reduce(
          (sum, week) => sum + week.broadImpressions,
          0,
        ),
        weeks,
      };
    }),
  );
  const endDate = new Date().toISOString().slice(0, 10);
  const related = input.seed
    ? await client.getRelatedKeywords({
        q: input.seed,
        country: input.country,
        language: input.language,
        startDate: addDays(endDate, -30),
        endDate,
      })
    : [];
  return {
    keywords,
    related: sort(related, (a, b) => b.impressions - a.impressions),
  };
}

export const BingPerformanceService = {
  summary,
  table,
  drilldown,
  compareSearchEngines,
  keywordStats,
};
