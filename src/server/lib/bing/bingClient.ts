import { z } from "zod";
import { BingApiError, type BingErrorKind } from "./bingErrors";

export { BingApiError, BingNotConnectedError } from "./bingErrors";

const BING_API_BASE = "https://ssl.bing.com/webmaster/api.svc/json";
const REQUEST_TIMEOUT_MS = 20_000;

// Bing's ApiErrorCode values that change how a failure is handled.
// https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.apierrorcode
const ERROR_CODE_KIND: Record<number, BingErrorKind> = {
  3: "auth", // InvalidApiKey
  4: "throttled", // ThrottleUser
  5: "throttled", // ThrottleHost
  6: "auth", // UserBlocked
  7: "invalid", // InvalidUrl
  8: "invalid", // InvalidParameter
  10: "auth", // UserNotFound
  13: "site_access", // NotAllowed
  14: "site_access", // NotAuthorized
};

const errorBodySchema = z.looseObject({
  ErrorCode: z.number().optional(),
  Message: z.string().optional(),
});

function messageFor(kind: BingErrorKind, detail: string): string {
  switch (kind) {
    case "auth":
      return "Bing rejected the API key. Generate a new one in Bing Webmaster Tools (Settings → API Access) and save it again.";
    case "site_access":
      return "The Bing account behind this API key can't read this site. Check that the site is verified in that account.";
    case "throttled":
      return "Bing Webmaster Tools rate limit reached. Retry later.";
    case "invalid":
      return `Bing rejected the request: ${detail}`;
    default:
      return `Bing Webmaster Tools API error: ${detail}`;
  }
}

async function toApiError(response: Response): Promise<BingApiError> {
  const text = await response.text().catch(() => "");
  let errorCode: number | undefined;
  let detail = text.slice(0, 300) || `HTTP ${response.status}`;
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      errorCode = parsed.data.ErrorCode;
      if (parsed.data.Message) detail = parsed.data.Message;
    }
  } catch {
    // Not JSON; keep the raw text as the detail.
  }
  const kind: BingErrorKind =
    (errorCode !== undefined ? ERROR_CODE_KIND[errorCode] : undefined) ??
    (response.status === 401 || response.status === 403
      ? "auth"
      : response.status === 429
        ? "throttled"
        : "other");
  return new BingApiError(
    kind,
    messageFor(kind, detail),
    response.status,
    errorCode,
  );
}

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
function bingDay(value: unknown): string | null {
  return parseBingDate(value)?.toISOString().slice(0, 10) ?? null;
}

function bingTimestamp(value: unknown): string | null {
  return parseBingDate(value)?.toISOString() ?? null;
}

/** Bing sends -1 (or 0) for a position that has no data, e.g. no clicks. */
function position(value: number | undefined): number | null {
  return value !== undefined && value > 0 ? value : null;
}

const count = z.number().catch(0);

const siteSchema = z.looseObject({
  Url: z.string(),
  IsVerified: z.boolean().catch(false),
});

const trafficRowSchema = z.looseObject({
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

const crawlStatsRowSchema = z.looseObject({
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

const crawlIssueSchema = z.looseObject({
  Url: z.string(),
  HttpCode: z.number().nullable().optional(),
  Issues: count,
  InLinks: z.number().nullable().optional(),
});

const linkCountsSchema = z.looseObject({
  Links: z
    .array(z.looseObject({ Url: z.string(), Count: count }))
    .nullable()
    .catch([]),
  TotalPages: count,
});

const urlLinksSchema = z.looseObject({
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

const feedSchema = z.looseObject({
  Url: z.string(),
  Status: z.string().nullable().optional(),
  Type: z.string().nullable().optional(),
  UrlCount: z.number().nullable().optional(),
  LastCrawled: z.string().nullable().optional(),
  Submitted: z.string().nullable().optional(),
});

const quotaSchema = z.looseObject({
  DailyQuota: count,
  MonthlyQuota: count,
});

const keywordSchema = z.looseObject({
  Query: z.string(),
  Impressions: count,
  BroadImpressions: count,
});

const keywordStatsSchema = z.looseObject({
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

function parseRows<T extends z.ZodType>(schema: T, data: unknown) {
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

function toQueryRows(data: unknown): BingQueryRow[] {
  return parseRows(statsRowSchema, data).flatMap((row) => {
    const metrics = toStatsMetrics(row);
    const query = row.Query ?? row.Page;
    return metrics && query ? [{ ...metrics, query }] : [];
  });
}

function toPageRows(data: unknown): BingPageRow[] {
  return parseRows(statsRowSchema, data).flatMap((row) => {
    const metrics = toStatsMetrics(row);
    const page = row.Page ?? row.Query;
    return metrics && page ? [{ ...metrics, page }] : [];
  });
}

/**
 * Free Bing Webmaster Tools client, authenticated with the user's API key.
 * Like the Search Console client it does NOT meter credits: Bing doesn't
 * charge for its webmaster data.
 */
export function createBingClient(apiKey: string) {
  async function call(
    method: string,
    params: Record<string, string | number> = {},
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = new URL(`${BING_API_BASE}/${method}`);
    url.searchParams.set("apikey", apiKey);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, String(value));
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body
          ? { "Content-Type": "application/json; charset=utf-8" }
          : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "TimeoutError";
      throw new BingApiError(
        "other",
        timedOut
          ? "Bing Webmaster Tools did not answer in time. Retry later."
          : "Could not reach Bing Webmaster Tools. Retry later.",
        timedOut ? 504 : 502,
      );
    }
    if (!response.ok) throw await toApiError(response);

    // Every JSON response is wrapped as {"d": ...}; a void method sends
    // {"d": null}. A body without "d" is not a Bing answer.
    const json: unknown = await response.json().catch(() => undefined);
    if (typeof json !== "object" || json === null || !("d" in json)) {
      throw new BingApiError(
        "other",
        messageFor("other", `unexpected response to ${method}`),
        response.status,
      );
    }
    return json.d;
  }

  return {
    /** Sites the key's account has added, verified or not. Also the cheapest
     *  way to check that a key works. */
    async getUserSites(): Promise<BingSite[]> {
      return parseRows(siteSchema, await call("GetUserSites")).map((site) => ({
        url: site.Url,
        isVerified: site.IsVerified,
      }));
    },

    async getRankAndTrafficStats(siteUrl: string): Promise<BingTrafficDay[]> {
      const rows = parseRows(
        trafficRowSchema,
        await call("GetRankAndTrafficStats", { siteUrl }),
      );
      return rows.flatMap((row) => {
        const date = bingDay(row.Date);
        return date
          ? [{ date, clicks: row.Clicks, impressions: row.Impressions }]
          : [];
      });
    },

    async getQueryStats(siteUrl: string): Promise<BingQueryRow[]> {
      return toQueryRows(await call("GetQueryStats", { siteUrl }));
    },

    async getPageStats(siteUrl: string): Promise<BingPageRow[]> {
      return toPageRows(await call("GetPageStats", { siteUrl }));
    },

    /** Pages that ranked for one query. */
    async getQueryPageStats(
      siteUrl: string,
      query: string,
    ): Promise<BingPageRow[]> {
      return toPageRows(await call("GetQueryPageStats", { siteUrl, query }));
    },

    /** Queries one page ranked for. */
    async getPageQueryStats(
      siteUrl: string,
      page: string,
    ): Promise<BingQueryRow[]> {
      return toQueryRows(await call("GetPageQueryStats", { siteUrl, page }));
    },

    async getCrawlStats(siteUrl: string): Promise<BingCrawlDay[]> {
      const rows = parseRows(
        crawlStatsRowSchema,
        await call("GetCrawlStats", { siteUrl }),
      );
      return rows.flatMap((row) => {
        const date = bingDay(row.Date);
        if (!date) return [];
        return [
          {
            date,
            crawledPages: row.CrawledPages ?? null,
            crawlErrors: row.CrawlErrors ?? null,
            inIndex: row.InIndex ?? null,
            inLinks: row.InLinks ?? null,
            code2xx: row.Code2xx ?? null,
            code301: row.Code301 ?? null,
            code302: row.Code302 ?? null,
            code4xx: row.Code4xx ?? null,
            code5xx: row.Code5xx ?? null,
            allOtherCodes: row.AllOtherCodes ?? null,
            blockedByRobotsTxt: row.BlockedByRobotsTxt ?? null,
            containsMalware: row.ContainsMalware ?? null,
            connectionTimeout: row.ConnectionTimeout ?? null,
            dnsFailures: row.DnsFailures ?? null,
          },
        ];
      });
    },

    /** Often empty even when Bing has crawl problems; treat as best-effort. */
    async getCrawlIssues(siteUrl: string): Promise<BingCrawlIssue[]> {
      const rows = parseRows(
        crawlIssueSchema,
        await call("GetCrawlIssues", { siteUrl }),
      );
      return rows.map((row) => ({
        url: row.Url,
        httpCode: row.HttpCode ?? null,
        issueFlags: row.Issues,
        inLinks: row.InLinks ?? null,
      }));
    },

    /** Pages of the site with their inbound link counts. `page` is zero-based. */
    async getLinkCounts(siteUrl: string, page: number) {
      const data = linkCountsSchema.parse(
        (await call("GetLinkCounts", { siteUrl, page })) ?? {
          Links: [],
          TotalPages: 0,
        },
      );
      return {
        links: (data.Links ?? []).map((link) => ({
          url: link.Url,
          count: link.Count,
        })),
        totalPages: data.TotalPages,
      };
    },

    /** Pages linking to one URL of the site. `page` is zero-based. */
    async getUrlLinks(siteUrl: string, link: string, page: number) {
      const data = urlLinksSchema.parse(
        (await call("GetUrlLinks", { siteUrl, link, page })) ?? {
          Details: [],
          TotalPages: 0,
        },
      );
      return {
        links: (data.Details ?? []).map((detail) => ({
          sourceUrl: detail.Url,
          anchorText: detail.AnchorText ?? null,
        })),
        totalPages: data.TotalPages,
      };
    },

    /** Sitemaps and feeds Bing knows for the site. */
    async getFeeds(siteUrl: string): Promise<BingFeed[]> {
      const rows = parseRows(feedSchema, await call("GetFeeds", { siteUrl }));
      return rows.map((feed) => ({
        url: feed.Url,
        status: feed.Status ?? null,
        type: feed.Type ?? null,
        urlCount: feed.UrlCount ?? null,
        lastCrawledAt: bingTimestamp(feed.LastCrawled),
        submittedAt: bingTimestamp(feed.Submitted),
      }));
    },

    async getUrlSubmissionQuota(siteUrl: string) {
      const quota = quotaSchema.parse(
        await call("GetUrlSubmissionQuota", { siteUrl }),
      );
      return { daily: quota.DailyQuota, monthly: quota.MonthlyQuota };
    },

    /** At most 500 URLs per call, and never more than the remaining quota. */
    async submitUrlBatch(siteUrl: string, urlList: string[]): Promise<void> {
      await call("SubmitUrlBatch", {}, { siteUrl, urlList });
    },

    /** Weekly Bing search counts for one keyword. Not tied to a site. */
    async getKeywordStats(q: string, country: string, language: string) {
      const rows = parseRows(
        keywordStatsSchema,
        await call("GetKeywordStats", { q, country, language }),
      );
      return rows.flatMap((row) => {
        const date = bingDay(row.Date);
        return date
          ? [
              {
                date,
                impressions: row.Impressions,
                broadImpressions: row.BroadImpressions,
              },
            ]
          : [];
      });
    },

    /** Keywords related to `q`, with their impressions over the range. */
    async getRelatedKeywords(input: {
      q: string;
      country: string;
      language: string;
      startDate: string;
      endDate: string;
    }): Promise<BingKeyword[]> {
      const rows = parseRows(
        keywordSchema,
        await call("GetRelatedKeywords", input),
      );
      return rows.map((row) => ({
        query: row.Query,
        impressions: row.Impressions,
        broadImpressions: row.BroadImpressions,
      }));
    },
  };
}

export type BingClient = ReturnType<typeof createBingClient>;
