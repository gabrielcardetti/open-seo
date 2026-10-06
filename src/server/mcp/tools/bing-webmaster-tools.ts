/* eslint-disable max-lines */
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  classifyBingFailure,
  type BingFailureReason,
} from "@/server/features/bing/bingFailures";
import { BingAiCitationService } from "@/server/features/bing/services/BingAiCitationService";
import {
  BingPerformanceService,
  type BingPerformanceRow,
} from "@/server/features/bing/services/BingPerformanceService";
import { BingService } from "@/server/features/bing/services/BingService";
import { BingSiteHealthService } from "@/server/features/bing/services/BingSiteHealthService";
import { BingSyncService } from "@/server/features/bing/services/BingSyncService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";
import { buildDashboardUrl } from "@/server/mcp/urls";
import { BING_STATS_SORTS, bingDateSchema } from "@/types/schemas/bing";

const DEFAULT_ROW_LIMIT = 100;
const MAX_ROW_LIMIT = 1000;
const TEXT_ROWS = 25;

const BING_LIMITS =
  "Bing reports no device or country split, buckets queries and pages by week, and only serves its last ~6 months; OpenSEO stores a copy every day, so history here starts when the project was connected and grows past Bing's window.";

type AuthContext = { baseUrl: string };

function bingPagePath(projectId: string) {
  return `/p/${projectId}/bing`;
}

function connectUrl(context: AuthContext, projectId: string) {
  return buildDashboardUrl(
    context.baseUrl,
    `/p/${projectId}/settings/integrations#bing-webmaster`,
  );
}

const FAILURE_TEXT: Record<BingFailureReason, string> = {
  not_connected: "Bing Webmaster Tools is not connected for this project.",
  key_invalid:
    "Bing rejected the saved API key. Save a new one (Bing Webmaster Tools → Settings → API Access).",
  site_access:
    "The Bing account behind the saved API key can't read this site. Check it's verified in that account.",
  throttled: "Bing Webmaster Tools rate limit reached. Retry later.",
  api_error: "Bing Webmaster Tools returned an error.",
};

function failureResponse(
  context: AuthContext,
  projectId: string,
  reason: BingFailureReason,
  detail?: string,
) {
  const url = connectUrl(context, projectId);
  const text = reason === "api_error" && detail ? detail : FAILURE_TEXT[reason];
  return mcpResponse({
    text: `${text} Manage the connection here: ${url}`,
    meta: buildProjectMeta(context, projectId, bingPagePath(projectId)),
    structuredContent: { ok: false, reason, connectUrl: url },
  });
}

/** Expected Bing failures become ok:false answers; anything else is a fault. */
function handleFailure(
  error: unknown,
  context: AuthContext,
  projectId: string,
) {
  const reason = classifyBingFailure(error);
  if (!reason) throw error;
  return failureResponse(
    context,
    projectId,
    reason,
    error instanceof Error ? error.message : undefined,
  );
}

function invalidRequest(
  context: AuthContext,
  projectId: string,
  message: string,
) {
  return mcpResponse({
    text: message,
    meta: buildProjectMeta(context, projectId, bingPagePath(projectId)),
    structuredContent: { ok: false, reason: "invalid_request" },
  });
}

const failureOutputShape = {
  ok: z.boolean(),
  reason: z.string().optional(),
  connectUrl: z.string().optional(),
  siteUrl: z.string().optional(),
  ...optionalMetaOutputSchema,
};

const rangeInputShape = {
  startDate: bingDateSchema
    .optional()
    .describe(
      "Range start (YYYY-MM-DD). Use with endDate. Default: the 28 days ending at the newest stored data.",
    ),
  endDate: bingDateSchema
    .optional()
    .describe("Range end (YYYY-MM-DD). Use with startDate."),
};

function halfRange(args: { startDate?: string; endDate?: string }) {
  return Boolean(args.startDate) !== Boolean(args.endDate);
}

const percent = (value: unknown) =>
  typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";
const oneDecimal = (value: unknown) =>
  typeof value === "number" ? value.toFixed(1) : "—";

type OutputRow = {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  clickPosition: number | null;
};

function roundPosition(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(1));
}

function toOutputRow(row: BingPerformanceRow): OutputRow {
  return {
    key: row.key,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Number(row.ctr.toFixed(4)),
    position: roundPosition(row.avgImpressionPosition),
    clickPosition: roundPosition(row.avgClickPosition),
  };
}

const PERF_COLUMNS: McpTableColumn<OutputRow>[] = [
  { header: "key", value: (row) => row.key },
  { header: "clicks", value: (row) => row.clicks },
  { header: "impressions", value: (row) => row.impressions },
  { header: "CTR", value: (row) => row.ctr, format: percent },
  { header: "position", value: (row) => row.position, format: oneDecimal },
];

// ---------------------------------------------------------------------------
// get_bing_overview
// ---------------------------------------------------------------------------

const overviewInputSchema = {
  projectId: projectIdSchema,
  ...rangeInputShape,
} as const;

export const getBingOverviewTool = {
  name: "get_bing_overview",
  config: {
    title: "Get Bing Webmaster overview",
    description: `The project's Bing Webmaster Tools picture: connection and last sync, URL submission quota, clicks/impressions/CTR for the range vs the previous equal-length range (from OpenSEO's stored daily history), crawl health (newest crawl day, open crawl issues, sitemaps), and AI citations when an AI Performance CSV was imported. When Bing's API (or the relay in front of it) is unreachable, outage says since when and when calls resume, and actionNeeded says so: stored data is current up to the last sync, and syncs retry by themselves. ${BING_LIMITS} Read-only; uses no credits.`,
    inputSchema: overviewInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      lastSyncedAt: z.string().nullable().optional(),
      lastSyncError: z.string().nullable().optional(),
      syncEnabled: z.boolean().optional(),
      outage: z.looseObject({}).nullable().optional(),
      actionNeeded: z.array(z.string()).optional(),
      range: z.looseObject({}).optional(),
      totals: z.looseObject({}).optional(),
      prevTotals: z.looseObject({}).optional(),
      crawl: z.looseObject({}).optional(),
      aiCitations: z.looseObject({}).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof overviewInputSchema>>, context) => {
      if (halfRange(args)) {
        return invalidRequest(
          context,
          args.projectId,
          "Provide both startDate and endDate, or neither.",
        );
      }
      const status = await BingService.getConnectionStatus({
        projectId: args.projectId,
        userId: context.auth.userId,
      });
      const summary = await BingPerformanceService.summary(
        args.projectId,
        args,
      );
      if (!status.connected || !summary.connected) {
        return failureResponse(context, args.projectId, "not_connected");
      }
      const [crawl, ai] = await Promise.all([
        BingSiteHealthService.crawlHealth(args.projectId),
        BingAiCitationService.citations(args.projectId, {
          startDate: summary.range.startDate,
          endDate: summary.range.endDate,
        }),
      ]);
      const latestCrawl = crawl.connected ? (crawl.daily.at(-1) ?? null) : null;
      const crawlSummary = crawl.connected
        ? {
            latestDay: latestCrawl,
            openIssues: crawl.openIssues.totalCount,
            sitemaps: crawl.sitemaps.length,
          }
        : null;
      const { range, totals, prevTotals } = summary;
      const actionNeeded = status.outage
        ? [
            `${status.outage.message} Bing data stays as of the last sync, and syncs and URL submissions resume by themselves.`,
          ]
        : [];
      const lines = [
        `${summary.siteUrl} · ${range.startDate}→${range.endDate} vs ${range.prevStartDate}→${range.prevEndDate}`,
        `Clicks ${totals.clicks} (prev ${prevTotals.clicks}) · Impressions ${totals.impressions} (prev ${prevTotals.impressions}) · CTR ${percent(totals.ctr)} (prev ${percent(prevTotals.ctr)})`,
        `Last sync: ${status.lastSyncedAt ?? "never"}${status.syncEnabled ? "" : " (daily sync off)"}${status.lastSyncError && !status.outage ? ` · last error: ${status.lastSyncError}` : ""}`,
        status.quota
          ? `URL submission quota left: ${status.quota.dailyRemaining ?? "?"} today, ${status.quota.monthlyRemaining ?? "?"} this month`
          : "URL submission quota: not checked yet",
        crawlSummary
          ? `Crawl: ${latestCrawl ? `${latestCrawl.date} — ${latestCrawl.crawledPages ?? "?"} crawled, ${latestCrawl.inIndex ?? "?"} in index, ${latestCrawl.crawlErrors ?? "?"} errors` : "no crawl data stored yet"} · ${crawlSummary.openIssues} open crawl issues · ${crawlSummary.sitemaps} sitemaps`
          : "",
        ai.hasData
          ? `AI citations (imported): ${ai.totalCitations} in range`
          : "AI citations: none imported (import Bing's AI Performance CSV in the app)",
        ...actionNeeded.map((line) => `Action needed: ${line}`),
      ].filter(Boolean);

      return mcpResponse({
        text: lines.join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          bingPagePath(args.projectId),
        ),
        structuredContent: {
          ok: true,
          siteUrl: summary.siteUrl,
          lastSyncedAt: status.lastSyncedAt,
          lastSyncError: status.lastSyncError,
          syncEnabled: status.syncEnabled,
          outage: status.outage,
          actionNeeded,
          quota: status.quota,
          range,
          totals,
          prevTotals,
          crawl: crawlSummary ?? undefined,
          aiCitations: {
            hasData: ai.hasData,
            totalCitations: ai.totalCitations,
          },
        },
      });
    },
  ),
};

// ---------------------------------------------------------------------------
// get_bing_search_performance
// ---------------------------------------------------------------------------

const performanceInputSchema = {
  projectId: projectIdSchema,
  dimension: z
    .enum(["query", "page", "date"])
    .optional()
    .describe(
      "Group rows by query (default), page, or date (site-wide daily clicks/impressions; Bing has no position per day).",
    ),
  ...rangeInputShape,
  search: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Keep queries/pages containing this text (case-insensitive)."),
  minImpressions: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Keep rows with at least this many impressions."),
  minPosition: z
    .number()
    .min(1)
    .optional()
    .describe(
      "Keep rows whose impression-weighted average position is >= this. Striking distance: minPosition 5, maxPosition 20.",
    ),
  maxPosition: z
    .number()
    .min(1)
    .optional()
    .describe("Keep rows whose average position is <= this."),
  sort: z
    .enum(BING_STATS_SORTS)
    .optional()
    .describe("Sort (default clicks; position sorts best first)."),
  rowLimit: z
    .number()
    .int()
    .min(1)
    .max(MAX_ROW_LIMIT)
    .optional()
    .describe(
      `Rows per call (default ${DEFAULT_ROW_LIMIT}, max ${MAX_ROW_LIMIT}).`,
    ),
  startRow: z.number().int().min(0).optional().describe("Pagination offset."),
  page: z
    .string()
    .url()
    .optional()
    .describe(
      "Drill down LIVE from Bing: the queries this page ranked for. Covers Bing's ~6-month window, not the stored history.",
    ),
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Drill down LIVE from Bing: the pages that ranked for this query.",
    ),
} as const;

type PerformanceArgs = z.infer<z.ZodObject<typeof performanceInputSchema>>;

function matchesFilters(row: OutputRow, args: PerformanceArgs) {
  if (
    args.minImpressions !== undefined &&
    row.impressions < args.minImpressions
  )
    return false;
  if (args.minPosition !== undefined && (row.position ?? 0) < args.minPosition)
    return false;
  if (
    args.maxPosition !== undefined &&
    (row.position === null || row.position > args.maxPosition)
  )
    return false;
  if (args.search && !row.key.toLowerCase().includes(args.search.toLowerCase()))
    return false;
  return true;
}

async function performanceRows(args: PerformanceArgs, limit: number) {
  const startRow = args.startRow ?? 0;
  if (args.page || args.query) {
    const result = await BingPerformanceService.drilldown(
      args.projectId,
      args.page
        ? { startDate: args.startDate, endDate: args.endDate, page: args.page }
        : {
            startDate: args.startDate,
            endDate: args.endDate,
            query: args.query ?? "",
          },
    );
    const kept = result.rows
      .map(toOutputRow)
      .filter((row) => matchesFilters(row, args));
    return {
      siteUrl: result.siteUrl,
      label: `${result.dimension}s for ${args.page ?? args.query} (live, Bing's ~6-month window)`,
      range: null,
      rows: kept.slice(startRow, startRow + limit),
      totalCount: kept.length,
    };
  }
  const dimension = args.dimension === "page" ? "page" : "query";
  const result = await BingPerformanceService.table(args.projectId, {
    dimension,
    startDate: args.startDate,
    endDate: args.endDate,
    search: args.search,
    minImpressions: args.minImpressions,
    minPosition: args.minPosition,
    maxPosition: args.maxPosition,
    sort: args.sort ?? "clicks",
    limit,
    offset: startRow,
  });
  if (!result.connected) return null;
  return {
    siteUrl: result.siteUrl,
    label: `${dimension} · ${result.range.startDate}→${result.range.endDate} (stored weekly buckets)`,
    range: result.range,
    rows: result.rows.map(toOutputRow),
    totalCount: result.totalCount,
  };
}

export const getBingSearchPerformanceTool = {
  name: "get_bing_search_performance",
  config: {
    title: "Get Bing search performance",
    description: `Bing clicks, impressions, CTR and average position by query or page over any range of OpenSEO's stored Bing history, or site-wide per day (dimension 'date'). Bing buckets query/page rows by week: a week counts when its date falls in the range, and position is the impression-weighted average over those weeks. Pass page (queries for that page) or query (pages for that query) to drill down live from Bing. ${BING_LIMITS} ctr is a 0-1 fraction. When traffic drops or jumps, check get_google_search_updates for a Google update in the same weeks. Read-only; uses no credits.`,
    inputSchema: performanceInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      dimension: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      rowCount: z.number().optional(),
      totalCount: z.number().optional(),
      rows: z.array(z.looseObject({})).optional(),
      hasMore: z.boolean().optional(),
      nextStartRow: z.number().optional(),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: PerformanceArgs, context) => {
    if (halfRange(args)) {
      return invalidRequest(
        context,
        args.projectId,
        "Provide both startDate and endDate, or neither.",
      );
    }
    if (args.page && args.query) {
      return invalidRequest(
        context,
        args.projectId,
        "Drill down by page or by query, not both.",
      );
    }
    const meta = buildProjectMeta(
      context,
      args.projectId,
      bingPagePath(args.projectId),
    );
    const limit = args.rowLimit ?? DEFAULT_ROW_LIMIT;

    try {
      if (args.dimension === "date" && !args.page && !args.query) {
        const summary = await BingPerformanceService.summary(
          args.projectId,
          args,
        );
        if (!summary.connected) {
          return failureResponse(context, args.projectId, "not_connected");
        }
        const rows = summary.daily.map((day) => ({
          ...day,
          ctr: Number(day.ctr.toFixed(4)),
        }));
        const header = `${summary.siteUrl} · daily · ${summary.range.startDate}→${summary.range.endDate} · ${rows.length} days`;
        return mcpResponse({
          text:
            rows.length > 0
              ? `${header}\n${formatMcpTable(rows, [
                  { header: "date", value: (row) => row.date },
                  { header: "clicks", value: (row) => row.clicks },
                  { header: "impressions", value: (row) => row.impressions },
                  { header: "CTR", value: (row) => row.ctr, format: percent },
                ])}`
              : `${header}\nNo stored data for this range.`,
          meta,
          structuredContent: {
            ok: true,
            siteUrl: summary.siteUrl,
            dimension: "date",
            startDate: summary.range.startDate,
            endDate: summary.range.endDate,
            rowCount: rows.length,
            rows,
          },
        });
      }

      const result = await performanceRows(args, limit);
      if (!result) {
        return failureResponse(context, args.projectId, "not_connected");
      }
      const startRow = args.startRow ?? 0;
      const hasMore = startRow + result.rows.length < result.totalCount;
      const header = `${result.siteUrl} · ${result.label} · ${result.rows.length} of ${result.totalCount} rows${hasMore ? " (more available — paginate with startRow)" : ""}`;
      return mcpResponse({
        text:
          result.rows.length > 0
            ? `${header}\n${formatMcpTable(result.rows, PERF_COLUMNS)}`
            : `${header}\nNo rows for this range and filters.`,
        meta,
        structuredContent: {
          ok: true,
          siteUrl: result.siteUrl,
          dimension: args.page
            ? "query"
            : args.query
              ? "page"
              : (args.dimension ?? "query"),
          startDate: result.range?.startDate,
          endDate: result.range?.endDate,
          rowCount: result.rows.length,
          totalCount: result.totalCount,
          rows: result.rows,
          hasMore,
          nextStartRow: hasMore ? startRow + result.rows.length : undefined,
        },
      });
    } catch (error) {
      return handleFailure(error, context, args.projectId);
    }
  }),
};

// ---------------------------------------------------------------------------
// get_bing_crawl_health
// ---------------------------------------------------------------------------

const crawlInputSchema = {
  projectId: projectIdSchema,
  startDate: bingDateSchema
    .optional()
    .describe(
      "Range start (YYYY-MM-DD). Use with endDate. Default: the 90 days ending at the newest stored crawl day.",
    ),
  endDate: bingDateSchema
    .optional()
    .describe("Range end (YYYY-MM-DD). Use with startDate."),
} as const;

export const getBingCrawlHealthTool = {
  name: "get_bing_crawl_health",
  config: {
    title: "Get Bing crawl health",
    description:
      "Bingbot's crawl of the site from OpenSEO's stored daily history: pages crawled, crawl errors, pages in index, status-code and robots.txt/malware/DNS/timeout counts per day; the URLs Bing currently reports crawl issues for (with best-effort labels decoded from Bing's issue flags, raw flags kept); issues resolved since the range began (Bing stopped reporting them); and the sitemaps Bing knows (noLongerReported: Bing dropped it from its list; kept as history). Bing's crawl-issue list is often empty even when problems exist. History starts when the project was connected. Read-only; uses no credits.",
    inputSchema: crawlInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      range: z.looseObject({}).optional(),
      daily: z.array(z.looseObject({})).optional(),
      openIssues: z.looseObject({}).optional(),
      resolvedIssues: z.array(z.looseObject({})).optional(),
      sitemaps: z.array(z.looseObject({})).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof crawlInputSchema>>, context) => {
      if (halfRange(args)) {
        return invalidRequest(
          context,
          args.projectId,
          "Provide both startDate and endDate, or neither.",
        );
      }
      const result = await BingSiteHealthService.crawlHealth(
        args.projectId,
        args,
      );
      if (!result.connected) {
        return failureResponse(context, args.projectId, "not_connected");
      }
      const issueColumns: McpTableColumn<
        (typeof result.openIssues.rows)[number]
      >[] = [
        { header: "url", value: (row) => row.url },
        { header: "http", value: (row) => row.httpCode },
        { header: "issues", value: (row) => row.labels.join(", ") },
        { header: "first seen", value: (row) => row.firstSeenAt.slice(0, 10) },
      ];
      const text = [
        `${result.siteUrl} · ${result.range.startDate}→${result.range.endDate} · ${result.daily.length} crawl days stored`,
        result.daily.length > 0
          ? formatMcpTable(result.daily.slice(-TEXT_ROWS), [
              { header: "date", value: (row) => row.date },
              { header: "crawled", value: (row) => row.crawledPages },
              { header: "errors", value: (row) => row.crawlErrors },
              { header: "in index", value: (row) => row.inIndex },
              { header: "4xx", value: (row) => row.code4xx },
              { header: "5xx", value: (row) => row.code5xx },
              { header: "robots", value: (row) => row.blockedByRobotsTxt },
            ])
          : "No crawl days stored for this range.",
        `Open crawl issues: ${result.openIssues.totalCount}`,
        result.openIssues.rows.length > 0
          ? formatMcpTable(
              result.openIssues.rows.slice(0, TEXT_ROWS),
              issueColumns,
            )
          : "",
        `Resolved since ${result.range.startDate}: ${result.resolvedIssues.length}`,
        `Sitemaps: ${result.sitemaps.map((sitemap) => `${sitemap.feedUrl} (${sitemap.status ?? "?"}, ${sitemap.urlCount ?? "?"} URLs${sitemap.noLongerReported ? ", no longer reported by Bing" : ""})`).join("; ") || "none"}`,
      ].filter(Boolean);
      return mcpResponse({
        text: text.join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          bingPagePath(args.projectId),
        ),
        structuredContent: {
          ok: true,
          siteUrl: result.siteUrl,
          range: result.range,
          daily: result.daily,
          openIssues: result.openIssues,
          resolvedIssues: result.resolvedIssues,
          sitemaps: result.sitemaps,
        },
      });
    },
  ),
};

// ---------------------------------------------------------------------------
// get_bing_backlinks
// ---------------------------------------------------------------------------

const backlinksInputSchema = {
  projectId: projectIdSchema,
  url: z
    .string()
    .url()
    .optional()
    .describe(
      "A page of the site: list the pages linking to it, live from Bing. Omit for the site's pages ranked by inbound links.",
    ),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based results page (default 1)."),
} as const;

export const getBingBacklinksTool = {
  name: "get_bing_backlinks",
  config: {
    title: "Get Bing backlinks",
    description:
      "Inbound links as Bing sees them. Without url: the site's pages ranked by inbound link count, from OpenSEO's newest weekly snapshot of Bing's link counts. With url: the pages linking to that URL and their anchor text, live from Bing (GetUrlLinks). Bing's own link index, free, and smaller than commercial backlink indexes. Read-only; uses no credits.",
    inputSchema: backlinksInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      mode: z.string().optional(),
      rows: z.array(z.looseObject({})).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<z.ZodObject<typeof backlinksInputSchema>>,
      context,
    ) => {
      const meta = buildProjectMeta(
        context,
        args.projectId,
        bingPagePath(args.projectId),
      );
      try {
        const result = await BingSiteHealthService.backlinks(args.projectId, {
          url: args.url,
          page: args.page ?? 1,
          pageSize: 50,
        });
        if (!result.connected) {
          return failureResponse(context, args.projectId, "not_connected");
        }
        if (result.mode === "links") {
          return mcpResponse({
            text: `${result.url} · page ${result.page} of ${result.totalPages} (live)\n${formatMcpTable(
              result.rows,
              [
                { header: "linking page", value: (row) => row.sourceUrl },
                { header: "anchor", value: (row) => row.anchorText },
              ],
            )}`,
            meta,
            structuredContent: { ok: true, ...result },
          });
        }
        const header = result.capturedOn
          ? `${result.siteUrl} · link counts captured ${result.capturedOn} · ${result.totalCount} pages`
          : `${result.siteUrl} · no link-count snapshot stored yet (captured weekly by the daily sync)`;
        return mcpResponse({
          text:
            result.rows.length > 0
              ? `${header}\n${formatMcpTable(result.rows, [
                  { header: "page", value: (row) => row.url },
                  { header: "inbound links", value: (row) => row.linkCount },
                ])}`
              : header,
          meta,
          structuredContent: { ok: true, ...result },
        });
      } catch (error) {
        return handleFailure(error, context, args.projectId);
      }
    },
  ),
};

// ---------------------------------------------------------------------------
// get_bing_keyword_stats
// ---------------------------------------------------------------------------

const keywordInputSchema = {
  projectId: projectIdSchema,
  keywords: z
    .array(z.string().trim().min(1).max(100))
    .max(5)
    .optional()
    .describe("1-5 keywords: weekly Bing search impressions for each."),
  seed: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "A seed keyword: related keywords with their Bing impressions over the last 30 days.",
    ),
  country: z
    .string()
    .trim()
    .min(2)
    .max(5)
    .optional()
    .describe("Bing country code, e.g. 'us' (default), 'gb', 'es'."),
  language: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .optional()
    .describe("Bing language-culture code, e.g. 'en-US' (default), 'es-ES'."),
} as const;

export const getBingKeywordStatsTool = {
  name: "get_bing_keyword_stats",
  config: {
    title: "Get Bing keyword stats",
    description:
      "Free Bing search demand, live from Bing Webmaster Tools through the project's connected key: weekly impressions (exact and broad) for up to 5 keywords, and related keywords for a seed. Bing-only volumes, not Google's. Experimental: these Bing methods (GetKeywordStats, GetRelatedKeywords) aren't verified against live answers yet, so empty or odd results may be the API, not the market. Read-only; uses no credits.",
    inputSchema: keywordInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      keywords: z.array(z.looseObject({})).optional(),
      related: z.array(z.looseObject({})).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof keywordInputSchema>>, context) => {
      if (!args.seed && !args.keywords?.length) {
        return invalidRequest(
          context,
          args.projectId,
          "Provide keywords, a seed, or both.",
        );
      }
      try {
        const result = await BingPerformanceService.keywordStats(
          args.projectId,
          {
            keywords: args.keywords ?? [],
            seed: args.seed,
            country: args.country ?? "us",
            language: args.language ?? "en-US",
          },
        );
        const keywordRows = result.keywords.map(({ weeks, ...row }) => ({
          ...row,
          weeks: weeks.length,
        }));
        const text = [
          keywordRows.length > 0
            ? formatMcpTable(keywordRows, [
                { header: "keyword", value: (row) => row.keyword },
                { header: "impressions", value: (row) => row.impressions },
                { header: "broad", value: (row) => row.broadImpressions },
                { header: "weeks", value: (row) => row.weeks },
              ])
            : "",
          args.seed
            ? `Related to "${args.seed}" (${result.related.length}):\n${formatMcpTable(
                result.related.slice(0, 50),
                [
                  { header: "keyword", value: (row) => row.query },
                  { header: "impressions", value: (row) => row.impressions },
                  { header: "broad", value: (row) => row.broadImpressions },
                ],
              )}`
            : "",
        ].filter(Boolean);
        return mcpResponse({
          text: text.join("\n\n"),
          meta: buildProjectMeta(
            context,
            args.projectId,
            bingPagePath(args.projectId),
          ),
          structuredContent: { ok: true, ...result },
        });
      } catch (error) {
        return handleFailure(error, context, args.projectId);
      }
    },
  ),
};

// ---------------------------------------------------------------------------
// compare_search_engines
// ---------------------------------------------------------------------------

const compareInputSchema = {
  projectId: projectIdSchema,
  dimension: z
    .enum(["query", "page"])
    .optional()
    .describe("Compare per query (default) or per page."),
  ...rangeInputShape,
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Rows to return (default 50), ranked by clicks on both engines."),
} as const;

export const compareSearchEnginesTool = {
  name: "compare_search_engines",
  config: {
    title: "Compare Google and Bing",
    description:
      "How the same queries or pages do on Google (Search Console) and Bing (OpenSEO's stored Bing history) over one range: clicks, impressions, CTR and average position side by side, joined per query (case-insensitive) or page (ignoring scheme, www and trailing slash). Rows missing on one engine show null there. Bing data comes in weekly buckets and Search Console lags ~3 days, so edges of the range differ slightly. Without Search Console it returns Bing only, with a note. Read-only; uses no credits.",
    inputSchema: compareInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      googleConnected: z.boolean().optional(),
      note: z.string().nullable().optional(),
      rows: z.array(z.looseObject({})).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof compareInputSchema>>, context) => {
      if (halfRange(args)) {
        return invalidRequest(
          context,
          args.projectId,
          "Provide both startDate and endDate, or neither.",
        );
      }
      const result = await BingPerformanceService.compareSearchEngines(
        args.projectId,
        {
          dimension: args.dimension ?? "query",
          startDate: args.startDate,
          endDate: args.endDate,
          limit: args.limit ?? 50,
        },
      );
      if (!result.connected) {
        return failureResponse(context, args.projectId, "not_connected");
      }
      const header = `${result.siteUrl} · ${result.dimension} · ${result.range.startDate}→${result.range.endDate}${result.note ? ` · ${result.note}` : ""}`;
      return mcpResponse({
        text:
          result.rows.length > 0
            ? `${header}\n${formatMcpTable(result.rows, [
                { header: "key", value: (row) => row.key },
                { header: "Google clicks", value: (row) => row.google?.clicks },
                { header: "Bing clicks", value: (row) => row.bing?.clicks },
                {
                  header: "Google impr.",
                  value: (row) => row.google?.impressions,
                },
                { header: "Bing impr.", value: (row) => row.bing?.impressions },
                {
                  header: "Google pos.",
                  value: (row) => row.google?.position,
                  format: oneDecimal,
                },
                {
                  header: "Bing pos.",
                  value: (row) => row.bing?.position,
                  format: oneDecimal,
                },
              ])}`
            : `${header}\nNo rows for this range.`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          bingPagePath(args.projectId),
        ),
        structuredContent: { ok: true, ...result },
      });
    },
  ),
};

// ---------------------------------------------------------------------------
// get_bing_ai_citations
// ---------------------------------------------------------------------------

const aiInputSchema = {
  projectId: projectIdSchema,
  ...rangeInputShape,
} as const;

export const getBingAiCitationsTool = {
  name: "get_bing_ai_citations",
  config: {
    title: "Get Bing AI citations",
    description:
      "How often Copilot and Bing's AI answers cited the site: citations per day, the most-cited pages and the top grounding queries for a range. Bing has no API for this yet, so the data only exists for periods someone imported Bing's AI Performance CSV export in the app; pages and queries are summed over every imported period that overlaps the range. Read-only; uses no credits.",
    inputSchema: aiInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      hasData: z.boolean().optional(),
      totalCitations: z.number().optional(),
      daily: z.array(z.looseObject({})).optional(),
      topPages: z.array(z.looseObject({})).optional(),
      topQueries: z.array(z.looseObject({})).optional(),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof aiInputSchema>>, context) => {
      if (halfRange(args)) {
        return invalidRequest(
          context,
          args.projectId,
          "Provide both startDate and endDate, or neither.",
        );
      }
      const result = await BingAiCitationService.citations(
        args.projectId,
        args,
      );
      const meta = buildProjectMeta(
        context,
        args.projectId,
        bingPagePath(args.projectId),
      );
      const header = `${result.range.startDate}→${result.range.endDate} · ${result.totalCitations} citations`;
      const text = result.hasData
        ? [
            header,
            result.topPages.length > 0
              ? formatMcpTable(result.topPages.slice(0, TEXT_ROWS), [
                  { header: "cited page", value: (row) => row.url },
                  { header: "citations", value: (row) => row.citations },
                ])
              : "",
            result.topQueries.length > 0
              ? formatMcpTable(result.topQueries.slice(0, TEXT_ROWS), [
                  { header: "grounding query", value: (row) => row.query },
                  { header: "citations", value: (row) => row.citations },
                ])
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        : `No AI citations imported for ${result.range.startDate}→${result.range.endDate}. Export AI Performance from Bing Webmaster Tools and import the CSV on the project's Bing page.`;
      return mcpResponse({
        text,
        meta,
        structuredContent: { ok: true, ...result },
      });
    },
  ),
};

// ---------------------------------------------------------------------------
// sync_bing_now
// ---------------------------------------------------------------------------

const syncInputSchema = { projectId: projectIdSchema } as const;

export const syncBingNowTool = {
  name: "sync_bing_now",
  config: {
    title: "Sync Bing Webmaster data now",
    description:
      "Download the project's Bing Webmaster data now instead of waiting for the daily sync: traffic, query and page stats, crawl stats and issues, sitemaps, URL submission quota (and link counts, weekly). At most once every 10 minutes per project. Requires permission to manage integrations. Uses no credits.",
    inputSchema: syncInputSchema,
    outputSchema: z.looseObject({
      ...failureOutputShape,
      status: z.string().optional(),
      datasets: z.looseObject({}).optional(),
      errors: z.array(z.string()).optional(),
      retryAfterSeconds: z.number().optional(),
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof syncInputSchema>>, context) => {
      requireOrgPermission(context.auth, { integration: ["manage"] });
      const result = await BingSyncService.syncNow(args.projectId);
      if (result.status === "not_connected") {
        return failureResponse(context, args.projectId, "not_connected");
      }
      const meta = buildProjectMeta(
        context,
        args.projectId,
        bingPagePath(args.projectId),
      );
      if (result.status === "too_soon") {
        return mcpResponse({
          text: `A Bing sync started at ${result.lastAttemptAt}. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} min.`,
          meta,
          structuredContent: {
            ok: false,
            reason: "too_soon",
            status: result.status,
            retryAfterSeconds: result.retryAfterSeconds,
          },
        });
      }
      const datasets = Object.entries(result.datasets)
        .map(([name, status]) => `${name}: ${status}`)
        .join(", ");
      return mcpResponse({
        text:
          result.outage
            ? `${result.siteUrl} sync stopped · ${datasets}\n${result.outage} The sync runs again by itself then.`
            :`${result.siteUrl} synced · ${datasets}${result.errors.length > 0 ? `\nErrors: ${result.errors.join("; ")}` : ""}`,
        meta,
        structuredContent: {
          ok: result.errors.length === 0,
          siteUrl: result.siteUrl,
          status: result.status,
          stoppedBy: result.stoppedBy,
          outage: result.outage,
          datasets: result.datasets,
          errors: result.errors,
        },
      });
    },
  ),
};
