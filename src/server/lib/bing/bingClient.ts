import { z } from "zod";
import {
  createUpstreamGate,
  isTransportStatus,
} from "@/server/features/upstreams/upstreamBreaker";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { BingApiError, type BingErrorKind } from "./bingErrors";
import {
  bingDay,
  bingTimestamp,
  crawlIssueSchema,
  crawlStatsRowSchema,
  feedSchema,
  keywordSchema,
  keywordStatsSchema,
  linkCountsSchema,
  parseRows,
  quotaSchema,
  siteSchema,
  toPageRows,
  toQueryRows,
  trafficRowSchema,
  urlLinksSchema,
  type BingCrawlDay,
  type BingCrawlIssue,
  type BingFeed,
  type BingKeyword,
  type BingPageRow,
  type BingQueryRow,
  type BingSite,
  type BingTrafficDay,
} from "./bingResponses";

export type {
  BingCrawlDay,
  BingCrawlIssue,
  BingFeed,
  BingPageRow,
  BingQueryRow,
  BingSite,
  BingTrafficDay,
} from "./bingResponses";

export { BingApiError } from "./bingErrors";

const BING_API_ORIGIN = "https://ssl.bing.com";
const BING_API_PATH = "/webmaster/api.svc/json";
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
  17: "throttled", // ThrottleIP
};

const THROTTLE_IP = 17;

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
  // An invalid key is a 400 with ErrorCode 3. A bare 403 (no ErrorCode) comes
  // from Bing's edge blocking the request, not from the key, so it must not
  // tell the user to replace a key that works.
  const kind: BingErrorKind =
    (errorCode !== undefined ? ERROR_CODE_KIND[errorCode] : undefined) ??
    (response.status === 401
      ? "auth"
      : response.status === 429
        ? "throttled"
        : "other");
  // Bing's answer never echoes the key, so it is safe to log.
  console.warn("[bing] API error", {
    status: response.status,
    errorCode,
    detail: detail.slice(0, 200),
  });
  return new BingApiError(
    kind,
    errorCode === THROTTLE_IP
      ? "Bing is rate-limiting this server's IP address. Deployments on Cloudflare Workers share their outbound IPs, so route Bing calls through a relay (BING_API_BASE_URL in the self-hosting guide)."
      : messageFor(kind, detail),
    response.status,
    errorCode,
  );
}

/**
 * Free Bing Webmaster Tools client, authenticated with the user's API key.
 * Like the Search Console client it does NOT meter credits: Bing doesn't
 * charge for its webmaster data.
 */
export function createBingClient(apiKey: string) {
  // While Bing or its relay is unreachable, calls fail fast without a fetch.
  const gate = createUpstreamGate("bing_api");
  const unreachable = (message: string, status: number) =>
    new BingApiError("unreachable", message, status);

  async function call(
    method: string,
    params: Record<string, string | number> = {},
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const outage = await gate.admit();
    if (outage) throw unreachable(outage.message, 503);
    // Bing throttles Cloudflare Workers' shared outbound IPs (ThrottleIP), so
    // a deployment can send its calls through a relay that forwards
    // /webmaster/api.svc/* to Bing and checks a shared secret.
    const origin =
      (await getOptionalEnvValue("BING_API_BASE_URL"))?.replace(/\/+$/, "") ||
      BING_API_ORIGIN;
    const relaySecret = await getOptionalEnvValue("BING_RELAY_SECRET");
    const url = new URL(`${origin}${BING_API_PATH}/${method}`);
    url.searchParams.set("apikey", apiKey);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, String(value));
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body
            ? { "Content-Type": "application/json; charset=utf-8" }
            : {}),
          ...(relaySecret ? { "X-Relay-Secret": relaySecret } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "TimeoutError";
      const opened = await gate.report(
        timedOut ? "timed out" : "network error",
      );
      throw unreachable(opened.message, timedOut ? 504 : 502);
    }
    if (isTransportStatus(response.status)) {
      await response.body?.cancel();
      console.warn("[bing] transport failure", { status: response.status });
      const opened = await gate.report(`HTTP ${response.status}`);
      throw unreachable(opened.message, response.status);
    }
    await gate.reachable();
    if (!response.ok) throw await toApiError(response);

    // Every JSON response is wrapped as {"d": ...}; a void method sends
    // {"d": null}. A body without "d" is not a Bing answer.
    const json: unknown = await response.json().catch(() => undefined);
    if (typeof json !== "object" || json === null || !("d" in json)) {
      console.warn("[bing] unexpected response", {
        method,
        status: response.status,
        contentType: response.headers.get("content-type"),
      });
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

    /** Register a sitemap or feed with Bing; it shows as Pending until crawled. */
    async submitFeed(siteUrl: string, feedUrl: string): Promise<void> {
      await call("SubmitFeed", {}, { siteUrl, feedUrl });
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
