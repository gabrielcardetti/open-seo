import { z } from "zod";

// Parsing for Bing Webmaster API responses: Bing's date strings, row schemas,
// and the camelCase shapes the client returns.

/**
 * Bing serializes dates as "/Date(1700000000000-0700)/". The milliseconds are
 * already UTC and the offset is informational, so it is ignored. Negative
 * values are Bing's null.
 */
const BING_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;

function parseBingDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = BING_DATE.exec(value);
  if (!match) return null;
  const ms = Number(match[1]);
  return ms < 0 ? null : new Date(ms);
}

/** The Bing day bucket as YYYY-MM-DD, rendered in UTC so it doesn't shift. */
export function bingDay(value: unknown): string | null {
  return parseBingDate(value)?.toISOString().slice(0, 10) ?? null;
}

export function bingTimestamp(value: unknown): string | null {
  return parseBingDate(value)?.toISOString() ?? null;
}

/** Bing sends -1 (or 0) for a position that has no data, e.g. no clicks. */
function position(value: number | undefined): number | null {
  return value !== undefined && value > 0 ? value : null;
}

const count = z.number().catch(0);

export const siteSchema = z.looseObject({
  Url: z.string(),
  IsVerified: z.boolean().catch(false),
});

export const trafficRowSchema = z.looseObject({
  Date: z.string(),
  Clicks: count,
  Impressions: count,
});

// GetQueryStats and GetPageStats share one row shape. For pages the URL has
// been reported under both `Query` and `Page`, so both are accepted.
const statsRowSchema = z.looseObject({
  Date: z.string(),
  Query: z.string().optional(),
  Page: z.string().optional(),
  Clicks: count,
  Impressions: count,
  AvgClickPosition: z.number().optional(),
  AvgImpressionPosition: z.number().optional(),
});

const optionalCount = z.number().nullable().optional();

export const crawlStatsRowSchema = z.looseObject({
  Date: z.string(),
  CrawledPages: optionalCount,
  CrawlErrors: optionalCount,
  InIndex: optionalCount,
  InLinks: optionalCount,
  Code2xx: optionalCount,
  Code301: optionalCount,
  Code302: optionalCount,
  Code4xx: optionalCount,
  Code5xx: optionalCount,
  AllOtherCodes: optionalCount,
  BlockedByRobotsTxt: optionalCount,
  ContainsMalware: optionalCount,
  ConnectionTimeout: optionalCount,
  DnsFailures: optionalCount,
});

export const crawlIssueSchema = z.looseObject({
  Url: z.string(),
  HttpCode: z.number().nullable().optional(),
  Issues: count,
  InLinks: z.number().nullable().optional(),
});

export const linkCountsSchema = z.looseObject({
  Links: z
    .array(z.looseObject({ Url: z.string(), Count: count }))
    .nullable()
    .catch([]),
  TotalPages: count,
});

export const urlLinksSchema = z.looseObject({
  Details: z
    .array(
      z.looseObject({
        Url: z.string(),
        AnchorText: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .catch([]),
  TotalPages: count,
});

export const feedSchema = z.looseObject({
  Url: z.string(),
  Status: z.string().nullable().optional(),
  Type: z.string().nullable().optional(),
  UrlCount: z.number().nullable().optional(),
  LastCrawled: z.string().nullable().optional(),
  Submitted: z.string().nullable().optional(),
});

export const quotaSchema = z.looseObject({
  DailyQuota: count,
  MonthlyQuota: count,
});

export const keywordSchema = z.looseObject({
  Query: z.string(),
  Impressions: count,
  BroadImpressions: count,
});

export const keywordStatsSchema = z.looseObject({
  Date: z.string(),
  Impressions: count,
  BroadImpressions: count,
});

export type BingSite = { url: string; isVerified: boolean };

export type BingTrafficDay = {
  date: string;
  clicks: number;
  impressions: number;
};

type BingStatsMetrics = {
  periodDate: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
};

export type BingQueryRow = BingStatsMetrics & { query: string };
export type BingPageRow = BingStatsMetrics & { page: string };

export type BingCrawlDay = {
  date: string;
  crawledPages: number | null;
  crawlErrors: number | null;
  inIndex: number | null;
  inLinks: number | null;
  code2xx: number | null;
  code301: number | null;
  code302: number | null;
  code4xx: number | null;
  code5xx: number | null;
  allOtherCodes: number | null;
  blockedByRobotsTxt: number | null;
  containsMalware: number | null;
  connectionTimeout: number | null;
  dnsFailures: number | null;
};

export type BingCrawlIssue = {
  url: string;
  httpCode: number | null;
  issueFlags: number;
  inLinks: number | null;
};

export type BingFeed = {
  url: string;
  status: string | null;
  type: string | null;
  urlCount: number | null;
  lastCrawledAt: string | null;
  submittedAt: string | null;
};

export type BingKeyword = {
  query: string;
  impressions: number;
  broadImpressions: number;
};

export function parseRows<T extends z.ZodType>(schema: T, data: unknown) {
  if (data === null) return [];
  return z.array(schema).parse(data);
}

function toStatsMetrics(
  row: z.infer<typeof statsRowSchema>,
): BingStatsMetrics | null {
  const periodDate = bingDay(row.Date);
  if (!periodDate) return null;
  return {
    periodDate,
    clicks: row.Clicks,
    impressions: row.Impressions,
    avgClickPosition: position(row.AvgClickPosition),
    avgImpressionPosition: position(row.AvgImpressionPosition),
  };
}

export function toQueryRows(data: unknown): BingQueryRow[] {
  return parseRows(statsRowSchema, data).flatMap((row) => {
    const metrics = toStatsMetrics(row);
    const query = row.Query ?? row.Page;
    return metrics && query ? [{ ...metrics, query }] : [];
  });
}

export function toPageRows(data: unknown): BingPageRow[] {
  return parseRows(statsRowSchema, data).flatMap((row) => {
    const metrics = toStatsMetrics(row);
    const page = row.Page ?? row.Query;
    return metrics && page ? [{ ...metrics, page }] : [];
  });
}
