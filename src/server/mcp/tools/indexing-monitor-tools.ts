/**
 * MCP tool for the Google indexing monitor: which of the project's sitemap
 * URLs Google has indexed, by URL template, over time, and which have
 * problems. Free: it reads stored URL Inspection results.
 */
import { z } from "zod";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  UrlInspectionService,
  type IndexingStatus,
} from "@/server/features/gsc/services/UrlInspectionService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, truncatedCell } from "@/server/mcp/table";
import { buildDashboardUrl } from "@/server/mcp/urls";
import {
  INDEXING_PROBLEM_KINDS,
  INDEXING_URL_STATUSES,
} from "@/shared/indexing";
import { indexingStatusFiltersSchema } from "@/types/schemas/indexing";

const TEXT_TEMPLATES = 15;
const DEFAULT_TREND_DAYS = 30;

const inputSchema = {
  projectId: projectIdSchema,
  template: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Only URLs of this template, exactly as byTemplate names it (e.g. '/jobs/:slug').",
    ),
  pathPrefix: z
    .string()
    .max(500)
    .optional()
    .describe("Only URLs whose path starts with this (e.g. '/blog/')."),
  status: z
    .enum(INDEXING_URL_STATUSES)
    .optional()
    .describe("Only indexed, not_indexed or not_inspected URLs."),
  coverageState: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Only URLs whose Google coverage state contains this text (e.g. 'Crawled - currently not indexed').",
    ),
  problem: z
    .enum(INDEXING_PROBLEM_KINDS)
    .optional()
    .describe("Only problems of this kind."),
  notIndexedDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe(
      "A URL still not indexed this many days after it first appeared in the sitemaps is a problem. Default 7.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Problem rows to return. Default 50."),
  trendDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe("Days of daily trend to return. Default 30."),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

function renderText(status: IndexingStatus, trendDays: number): string {
  const { totals, monitor } = status;
  const lines = [
    `${status.siteUrl} · ${totals.monitored} sitemap URLs monitored${totals.matching === totals.monitored ? "" : `, ${totals.matching} match the filters`}: ${totals.indexed} indexed, ${totals.notIndexed} not indexed, ${totals.notInspected} not inspected yet.`,
    `Monitor: last run ${monitor.lastRunAt ?? "never"}, URLs read from sitemaps ${monitor.urlsRefreshedAt ?? "never"}, ${monitor.inspectionsToday}/${monitor.dailyBudget} inspections today.${monitor.lastError ? ` Problem: ${monitor.lastError}` : ""}`,
  ];
  if (status.byState.length > 0) {
    lines.push(
      "",
      "By coverage state:",
      ...status.byState.map((row) => `- ${row.state}: ${row.urls}`),
    );
  }
  if (status.byTemplate.length > 0) {
    lines.push(
      "",
      formatMcpTable(status.byTemplate.slice(0, TEXT_TEMPLATES), [
        { header: "template", value: (row) => row.template },
        { header: "urls", value: (row) => row.urls },
        { header: "indexed", value: (row) => row.indexed },
        { header: "not indexed", value: (row) => row.notIndexed },
        { header: "not inspected", value: (row) => row.notInspected },
      ]),
    );
  }
  const trend = status.trend.slice(-trendDays);
  const first = trend.at(0);
  const last = trend.at(-1);
  if (first && last) {
    lines.push(
      "",
      `Trend ${first.date} → ${last.date}: indexed ${first.indexed} → ${last.indexed}, not indexed ${first.notIndexed} → ${last.notIndexed}.`,
    );
  }
  const counts = Object.entries(status.problemCounts)
    .filter(([, value]) => value > 0)
    .map(([kind, value]) => `${kind} ${value}`);
  lines.push(
    "",
    counts.length > 0
      ? `Problems (${status.problemTotal} URLs): ${counts.join(", ")}.`
      : "No problems found.",
  );
  if (status.problems.length > 0) {
    lines.push(
      formatMcpTable(status.problems, [
        { header: "url", value: (row) => row.url },
        { header: "problems", value: (row) => row.kinds.join(", ") },
        {
          header: "coverage",
          value: (row) => row.coverageState ?? row.lastError,
          format: truncatedCell(60),
        },
        { header: "google canonical", value: (row) => row.googleCanonical },
        { header: "first seen", value: (row) => row.firstSeenAt.slice(0, 10) },
      ]),
    );
  }
  return lines.join("\n");
}

export const getIndexingStatusTool = {
  name: "get_indexing_status",
  config: {
    title: "Get Google indexing status",
    description:
      "Which of the project's sitemap URLs Google has indexed, from OpenSEO's indexing monitor: it reads the URLs the project's sitemaps list and checks each with Search Console's URL Inspection API on a schedule (new URLs first, URLs not indexed yet daily, indexed ones weekly, within Google's daily quota). Returns totals, counts per Google coverage state and per URL template, a daily indexed/not-indexed trend, and problems: lost_indexing (was indexed, now isn't), noindex, fetch_error (404, soft 404, 5xx, blocked by robots.txt), canonical_mismatch (Google chose another canonical), not_indexed_after_days (still not indexed N days after first appearing), inspection_failed. Filter by template, path prefix, status, coverage state or problem kind; the trend always covers every monitored URL. Search Console's own sitemap 'indexed' counts are no longer reliable; this is the per-URL answer. To re-check specific URLs now, call inspect_urls (its results feed this monitor). Needs Search Console connected. Uses no credits.",
    inputSchema,
    outputSchema: z.looseObject({
      ok: z.boolean(),
      reason: z.string().optional(),
      connectUrl: z.string().optional(),
      siteUrl: z.string().nullable().optional(),
      totals: looseObjectOutputSchema.optional(),
      byState: z.array(looseObjectOutputSchema).optional(),
      byTemplate: z.array(looseObjectOutputSchema).optional(),
      trend: z.array(looseObjectOutputSchema).optional(),
      problems: z.array(looseObjectOutputSchema).optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const indexingPath = `/p/${args.projectId}/indexing`;
    const meta = buildProjectMeta(context, args.projectId, indexingPath);
    if (!(await GscConnectionRepository.getByProjectId(args.projectId))) {
      const connectUrl = buildDashboardUrl(
        context.baseUrl,
        `/p/${args.projectId}/search-performance`,
      );
      return mcpResponse({
        text: `Search Console is not connected for this project, so there is no indexing monitor. Connect it here: ${connectUrl}`,
        meta,
        structuredContent: { ok: false, reason: "not_connected", connectUrl },
      });
    }
    const days = args.trendDays ?? DEFAULT_TREND_DAYS;
    // The schema drops projectId and trendDays and fills the defaults.
    const status = await UrlInspectionService.status(
      args.projectId,
      indexingStatusFiltersSchema.parse(args),
    );
    return mcpResponse({
      text: renderText(status, days),
      meta,
      structuredContent: {
        ok: true,
        ...status,
        trend: status.trend.slice(-days),
      },
    });
  }),
};
