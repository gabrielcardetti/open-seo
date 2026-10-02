/* eslint-disable max-lines */
import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  max,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { uniqueBy } from "remeda";
import { db } from "@/db";
import {
  bingCrawlDaily,
  bingCrawlIssues,
  bingLinkCounts,
  bingPageStats,
  bingQueryStats,
  bingSitemaps,
  bingTrafficDaily,
} from "@/db/schema";
import type {
  BingCrawlDay,
  BingCrawlIssue,
  BingFeed,
  BingPageRow,
  BingQueryRow,
  BingTrafficDay,
} from "@/server/lib/bing/bingClient";
import { writeRowsInChunks } from "./chunkedWrites";

type SiteScope = { projectId: string; siteUrl: string };

export type BingStatsDimension = "query" | "page";
export type BingStatsSort = "clicks" | "impressions" | "ctr" | "position";

export type BingAggregatedRow = {
  key: string;
  clicks: number;
  impressions: number;
  /** Impression-weighted average of the buckets' impression positions. */
  avgImpressionPosition: number | null;
  /** Click-weighted average of the buckets' click positions. */
  avgClickPosition: number | null;
};

// ---------------------------------------------------------------------------
// Writes. Every snapshot write is an upsert on the table's natural key, so a
// re-sync of Bing's rolling window refreshes rows instead of duplicating them.
// ---------------------------------------------------------------------------

async function upsertTraffic(
  scope: SiteScope,
  days: BingTrafficDay[],
  now: string,
): Promise<void> {
  const rows = uniqueBy(days, (day) => day.date).map((day) => ({
    ...scope,
    date: day.date,
    clicks: day.clicks,
    impressions: day.impressions,
    updatedAt: now,
  }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingTrafficDaily)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingTrafficDaily.projectId,
          bingTrafficDaily.siteUrl,
          bingTrafficDaily.date,
        ],
        set: {
          clicks: sql`excluded.clicks`,
          impressions: sql`excluded.impressions`,
          updatedAt: now,
        },
      }),
  );
}

const statsSet = (now: string) => ({
  clicks: sql`excluded.clicks`,
  impressions: sql`excluded.impressions`,
  avgClickPosition: sql`excluded.avg_click_position`,
  avgImpressionPosition: sql`excluded.avg_impression_position`,
  updatedAt: now,
});

// One statement can't upsert the same key twice on Postgres, so a repeated
// (bucket, key) row from Bing keeps its first occurrence.
async function upsertQueryStats(
  scope: SiteScope,
  stats: BingQueryRow[],
  now: string,
): Promise<void> {
  const rows = uniqueBy(stats, (row) => `${row.periodDate}\n${row.query}`).map(
    (row) => ({ ...scope, ...row, updatedAt: now }),
  );
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingQueryStats)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingQueryStats.projectId,
          bingQueryStats.siteUrl,
          bingQueryStats.periodDate,
          bingQueryStats.query,
        ],
        set: statsSet(now),
      }),
  );
}

async function upsertPageStats(
  scope: SiteScope,
  stats: BingPageRow[],
  now: string,
): Promise<void> {
  const rows = uniqueBy(stats, (row) => `${row.periodDate}\n${row.page}`).map(
    (row) => ({ ...scope, ...row, updatedAt: now }),
  );
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingPageStats)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingPageStats.projectId,
          bingPageStats.siteUrl,
          bingPageStats.periodDate,
          bingPageStats.page,
        ],
        set: statsSet(now),
      }),
  );
}

async function upsertCrawlDays(
  scope: SiteScope,
  days: BingCrawlDay[],
  now: string,
): Promise<void> {
  const rows = uniqueBy(days, (day) => day.date).map((day) => ({
    ...scope,
    ...day,
    updatedAt: now,
  }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingCrawlDaily)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingCrawlDaily.projectId,
          bingCrawlDaily.siteUrl,
          bingCrawlDaily.date,
        ],
        set: {
          crawledPages: sql`excluded.crawled_pages`,
          crawlErrors: sql`excluded.crawl_errors`,
          inIndex: sql`excluded.in_index`,
          inLinks: sql`excluded.in_links`,
          code2xx: sql`excluded.code_2xx`,
          code301: sql`excluded.code_301`,
          code302: sql`excluded.code_302`,
          code4xx: sql`excluded.code_4xx`,
          code5xx: sql`excluded.code_5xx`,
          allOtherCodes: sql`excluded.all_other_codes`,
          blockedByRobotsTxt: sql`excluded.blocked_by_robots_txt`,
          containsMalware: sql`excluded.contains_malware`,
          connectionTimeout: sql`excluded.connection_timeout`,
          dnsFailures: sql`excluded.dns_failures`,
          updatedAt: now,
        },
      }),
  );
}

/**
 * Record the URLs Bing currently reports, then resolve every open issue this
 * report no longer lists. Only call it with a successful GetCrawlIssues
 * answer: a failed call says nothing about what was fixed. An issue seen again
 * after it was resolved reopens.
 */
async function replaceCrawlIssues(
  scope: SiteScope,
  issues: BingCrawlIssue[],
  now: string,
): Promise<void> {
  const rows = uniqueBy(issues, (issue) => issue.url).map((issue) => ({
    ...scope,
    ...issue,
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: null,
  }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingCrawlIssues)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingCrawlIssues.projectId,
          bingCrawlIssues.siteUrl,
          bingCrawlIssues.url,
        ],
        set: {
          httpCode: sql`excluded.http_code`,
          issueFlags: sql`excluded.issue_flags`,
          inLinks: sql`excluded.in_links`,
          lastSeenAt: now,
          resolvedAt: null,
        },
      }),
  );
  await db
    .update(bingCrawlIssues)
    .set({ resolvedAt: now })
    .where(
      and(
        eq(bingCrawlIssues.projectId, scope.projectId),
        eq(bingCrawlIssues.siteUrl, scope.siteUrl),
        isNull(bingCrawlIssues.resolvedAt),
        lt(bingCrawlIssues.lastSeenAt, now),
      ),
    );
}

async function insertLinkCounts(
  scope: SiteScope,
  capturedOn: string,
  links: Array<{ url: string; count: number }>,
): Promise<void> {
  const rows = uniqueBy(links, (link) => link.url).map((link) => ({
    ...scope,
    capturedOn,
    url: link.url,
    linkCount: link.count,
  }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingLinkCounts)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingLinkCounts.projectId,
          bingLinkCounts.siteUrl,
          bingLinkCounts.capturedOn,
          bingLinkCounts.url,
        ],
        set: { linkCount: sql`excluded.link_count` },
      }),
  );
}

async function upsertSitemaps(
  scope: SiteScope,
  feeds: BingFeed[],
  now: string,
): Promise<void> {
  const rows = uniqueBy(feeds, (feed) => feed.url).map((feed) => ({
    ...scope,
    feedUrl: feed.url,
    status: feed.status,
    urlCount: feed.urlCount,
    lastCrawledAt: feed.lastCrawledAt,
    submittedAt: feed.submittedAt,
    firstSeenAt: now,
    lastSeenAt: now,
  }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingSitemaps)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingSitemaps.projectId,
          bingSitemaps.siteUrl,
          bingSitemaps.feedUrl,
        ],
        set: {
          status: sql`excluded.status`,
          urlCount: sql`excluded.url_count`,
          lastCrawledAt: sql`excluded.last_crawled_at`,
          submittedAt: sql`excluded.submitted_at`,
          lastSeenAt: now,
        },
      }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getLatestTrafficDate(scope: SiteScope): Promise<string | null> {
  const [row] = await db
    .select({ latest: max(bingTrafficDaily.date) })
    .from(bingTrafficDaily)
    .where(
      and(
        eq(bingTrafficDaily.projectId, scope.projectId),
        eq(bingTrafficDaily.siteUrl, scope.siteUrl),
      ),
    );
  return row?.latest ?? null;
}

async function getTrafficDays(
  scope: SiteScope,
  startDate: string,
  endDate: string,
) {
  return db
    .select({
      date: bingTrafficDaily.date,
      clicks: bingTrafficDaily.clicks,
      impressions: bingTrafficDaily.impressions,
    })
    .from(bingTrafficDaily)
    .where(
      and(
        eq(bingTrafficDaily.projectId, scope.projectId),
        eq(bingTrafficDaily.siteUrl, scope.siteUrl),
        between(bingTrafficDaily.date, startDate, endDate),
      ),
    )
    .orderBy(asc(bingTrafficDaily.date));
}

type StatsColumns = {
  table: SQLiteTable;
  projectId: SQLiteColumn;
  siteUrl: SQLiteColumn;
  periodDate: SQLiteColumn;
  key: SQLiteColumn;
  clicks: SQLiteColumn;
  impressions: SQLiteColumn;
  avgClickPosition: SQLiteColumn;
  avgImpressionPosition: SQLiteColumn;
};

function statsColumns(dimension: BingStatsDimension): StatsColumns {
  const table = dimension === "query" ? bingQueryStats : bingPageStats;
  return {
    table,
    projectId: table.projectId,
    siteUrl: table.siteUrl,
    periodDate: table.periodDate,
    key: dimension === "query" ? bingQueryStats.query : bingPageStats.page,
    clicks: table.clicks,
    impressions: table.impressions,
    avgClickPosition: table.avgClickPosition,
    avgImpressionPosition: table.avgImpressionPosition,
  };
}

async function getLatestStatsDate(
  dimension: BingStatsDimension,
  scope: SiteScope,
): Promise<string | null> {
  const c = statsColumns(dimension);
  const [row] = await db
    .select({ latest: sql<string | null>`max(${c.periodDate})` })
    .from(c.table)
    .where(and(eq(c.projectId, scope.projectId), eq(c.siteUrl, scope.siteUrl)));
  return row?.latest ?? null;
}

/** LIKE pattern for a case-insensitive substring match, with LIKE's own
 *  wildcards escaped so a search for "100%" means the literal text. */
function containsPattern(search: string): string {
  return `%${search.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Sum Bing's weekly buckets per query or page over [startDate, endDate] (a
 * bucket counts when its date falls in the range). Positions are averaged
 * with the weight Bing's own averages carry: impression position by
 * impressions, click position by clicks, each over the buckets that report
 * one. Every expression is portable SQL (SQLite and Postgres); the explicit
 * REAL casts keep SQLite from integer division and Postgres from bigint.
 */
async function aggregateStats(input: {
  dimension: BingStatsDimension;
  scope: SiteScope;
  startDate: string;
  endDate: string;
  search?: string;
  minImpressions?: number;
  minPosition?: number;
  maxPosition?: number;
  sort: BingStatsSort;
  limit: number;
  offset: number;
}): Promise<{ rows: BingAggregatedRow[]; totalCount: number }> {
  const c = statsColumns(input.dimension);
  const clicks = sql`sum(${c.clicks})`;
  const impressions = sql`sum(${c.impressions})`;
  const impressionPosition = sql`cast(sum(${c.avgImpressionPosition} * ${c.impressions}) as real) / cast(nullif(sum(case when ${c.avgImpressionPosition} is not null then ${c.impressions} else 0 end), 0) as real)`;
  const clickPosition = sql`cast(sum(${c.avgClickPosition} * ${c.clicks}) as real) / cast(nullif(sum(case when ${c.avgClickPosition} is not null then ${c.clicks} else 0 end), 0) as real)`;
  const ctr = sql`cast(${clicks} as real) / cast(nullif(${impressions}, 0) as real)`;

  const where = and(
    eq(c.projectId, input.scope.projectId),
    eq(c.siteUrl, input.scope.siteUrl),
    between(c.periodDate, input.startDate, input.endDate),
    input.search
      ? sql`lower(${c.key}) like ${containsPattern(input.search)} escape '\\'`
      : undefined,
  );
  const having: SQL[] = [];
  if (input.minImpressions !== undefined) {
    having.push(sql`${impressions} >= ${input.minImpressions}`);
  }
  if (input.minPosition !== undefined) {
    having.push(sql`${impressionPosition} >= ${input.minPosition}`);
  }
  if (input.maxPosition !== undefined) {
    having.push(sql`${impressionPosition} <= ${input.maxPosition}`);
  }

  const order: SQL[] =
    input.sort === "position"
      ? // Rows without a position sort last on both dialects.
        [sql`(${impressionPosition}) is null`, asc(impressionPosition)]
      : input.sort === "ctr"
        ? [desc(ctr), desc(impressions)]
        : input.sort === "impressions"
          ? [desc(impressions), desc(clicks)]
          : [desc(clicks), desc(impressions)];

  // Drizzle builders mutate as they chain, so the page and the count each get
  // their own.
  const grouped = () =>
    db
      .select({
        key: sql<string>`${c.key}`.as("key"),
        clicks: clicks.mapWith(Number).as("clicks"),
        impressions: impressions.mapWith(Number).as("impressions"),
        avgImpressionPosition: impressionPosition
          .mapWith(Number)
          .as("avg_impression_position"),
        avgClickPosition: clickPosition
          .mapWith(Number)
          .as("avg_click_position"),
      })
      .from(c.table)
      .where(where)
      .groupBy(c.key)
      .having(having.length > 0 ? and(...having) : undefined);

  const [rows, [total]] = await Promise.all([
    grouped()
      .orderBy(...order, asc(c.key))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ n: count() }).from(grouped().as("grouped")),
  ]);
  return { rows, totalCount: total?.n ?? 0 };
}

async function getLatestCrawlDate(scope: SiteScope): Promise<string | null> {
  const [row] = await db
    .select({ latest: max(bingCrawlDaily.date) })
    .from(bingCrawlDaily)
    .where(
      and(
        eq(bingCrawlDaily.projectId, scope.projectId),
        eq(bingCrawlDaily.siteUrl, scope.siteUrl),
      ),
    );
  return row?.latest ?? null;
}

async function getCrawlDays(
  scope: SiteScope,
  startDate: string,
  endDate: string,
) {
  return db
    .select()
    .from(bingCrawlDaily)
    .where(
      and(
        eq(bingCrawlDaily.projectId, scope.projectId),
        eq(bingCrawlDaily.siteUrl, scope.siteUrl),
        between(bingCrawlDaily.date, startDate, endDate),
      ),
    )
    .orderBy(asc(bingCrawlDaily.date));
}

const issueFields = {
  url: bingCrawlIssues.url,
  httpCode: bingCrawlIssues.httpCode,
  issueFlags: bingCrawlIssues.issueFlags,
  inLinks: bingCrawlIssues.inLinks,
  firstSeenAt: bingCrawlIssues.firstSeenAt,
  lastSeenAt: bingCrawlIssues.lastSeenAt,
  resolvedAt: bingCrawlIssues.resolvedAt,
};

function issueScope(scope: SiteScope) {
  return and(
    eq(bingCrawlIssues.projectId, scope.projectId),
    eq(bingCrawlIssues.siteUrl, scope.siteUrl),
  );
}

async function getOpenCrawlIssues(scope: SiteScope, limit: number) {
  const where = and(issueScope(scope), isNull(bingCrawlIssues.resolvedAt));
  const [rows, [total]] = await Promise.all([
    db
      .select(issueFields)
      .from(bingCrawlIssues)
      .where(where)
      .orderBy(desc(bingCrawlIssues.lastSeenAt), asc(bingCrawlIssues.url))
      .limit(limit),
    db.select({ n: count() }).from(bingCrawlIssues).where(where),
  ]);
  return { rows, totalCount: total?.n ?? 0 };
}

async function getResolvedCrawlIssues(
  scope: SiteScope,
  resolvedSince: string,
  limit: number,
) {
  return db
    .select(issueFields)
    .from(bingCrawlIssues)
    .where(
      and(
        issueScope(scope),
        isNotNull(bingCrawlIssues.resolvedAt),
        gte(bingCrawlIssues.resolvedAt, resolvedSince),
      ),
    )
    .orderBy(desc(bingCrawlIssues.resolvedAt), asc(bingCrawlIssues.url))
    .limit(limit);
}

async function getSitemaps(scope: SiteScope) {
  return db
    .select({
      feedUrl: bingSitemaps.feedUrl,
      status: bingSitemaps.status,
      urlCount: bingSitemaps.urlCount,
      lastCrawledAt: bingSitemaps.lastCrawledAt,
      submittedAt: bingSitemaps.submittedAt,
      firstSeenAt: bingSitemaps.firstSeenAt,
      lastSeenAt: bingSitemaps.lastSeenAt,
    })
    .from(bingSitemaps)
    .where(
      and(
        eq(bingSitemaps.projectId, scope.projectId),
        eq(bingSitemaps.siteUrl, scope.siteUrl),
      ),
    )
    .orderBy(asc(bingSitemaps.feedUrl));
}

async function getLatestLinkCaptureDate(
  scope: SiteScope,
): Promise<string | null> {
  const [row] = await db
    .select({ latest: max(bingLinkCounts.capturedOn) })
    .from(bingLinkCounts)
    .where(
      and(
        eq(bingLinkCounts.projectId, scope.projectId),
        eq(bingLinkCounts.siteUrl, scope.siteUrl),
      ),
    );
  return row?.latest ?? null;
}

/** One capture day's pages, most-linked first. */
async function getLinkCounts(
  scope: SiteScope,
  capturedOn: string,
  limit: number,
  offset: number,
) {
  const where = and(
    eq(bingLinkCounts.projectId, scope.projectId),
    eq(bingLinkCounts.siteUrl, scope.siteUrl),
    eq(bingLinkCounts.capturedOn, capturedOn),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ url: bingLinkCounts.url, linkCount: bingLinkCounts.linkCount })
      .from(bingLinkCounts)
      .where(where)
      .orderBy(desc(bingLinkCounts.linkCount), asc(bingLinkCounts.url))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(bingLinkCounts).where(where),
  ]);
  return { rows, totalCount: total?.n ?? 0 };
}

export const BingSnapshotRepository = {
  upsertTraffic,
  upsertQueryStats,
  upsertPageStats,
  upsertCrawlDays,
  replaceCrawlIssues,
  insertLinkCounts,
  upsertSitemaps,
  getLatestTrafficDate,
  getTrafficDays,
  getLatestStatsDate,
  aggregateStats,
  getLatestCrawlDate,
  getCrawlDays,
  getOpenCrawlIssues,
  getResolvedCrawlIssues,
  getSitemaps,
  getLatestLinkCaptureDate,
  getLinkCounts,
};
