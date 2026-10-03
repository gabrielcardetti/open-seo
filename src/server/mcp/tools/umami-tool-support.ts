// Shared input schemas, failure answers and text rendering for the Umami
// MCP tools in umami-tools.ts.
import { z } from "zod";
import type { UmamiReportingService } from "@/server/features/umami/services/UmamiReportingService";
import {
  classifyUmamiFailure,
  type UmamiFailureReason,
} from "@/server/features/umami/umamiFailures";
import { inclusiveGa4Days } from "@/server/features/ga4/services/Ga4Dates";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";
import { buildDashboardUrl } from "@/server/mcp/urls";

const MAX_RANGE_DAYS = 731;
export const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

export const UMAMI_NOTES =
  "Dates are UTC days; the default range is the last 28 complete days, compared with the 28 before. Organic search means visits referred by a search engine (Google, Bing, DuckDuckGo, Yahoo, Yandex, Ecosia, Baidu, Brave): Umami has no channel filter. Read-only and uses no OpenSEO credits.";

type AuthContext = { baseUrl: string };
type RangeArgs = { projectId: string; startDate?: string; endDate?: string };

function connectUrl(context: AuthContext, projectId: string) {
  return buildDashboardUrl(
    context.baseUrl,
    `/p/${projectId}/settings/integrations#umami`,
  );
}

const FAILURE_TEXT: Record<UmamiFailureReason, string> = {
  not_connected:
    "Umami is not connected for this project, or no website was chosen.",
  auth: "Umami rejected the saved credentials, or that user can't read the website. Save the connection again.",
  website_not_found:
    "Umami can't find the connected website any more. Choose the website again.",
  throttled: "Umami is rate-limiting requests. Retry in a few minutes.",
  api_error: "Umami returned an error.",
};

/** Expected Umami failures become ok:false answers; anything else is a fault. */
function failureResponse(
  context: AuthContext,
  projectId: string,
  error: unknown,
) {
  const reason = classifyUmamiFailure(error);
  if (!reason) throw error;
  const url = connectUrl(context, projectId);
  const text =
    reason === "api_error" && error instanceof Error
      ? error.message
      : FAILURE_TEXT[reason];
  return mcpResponse({
    text: `${text} Manage the connection here: ${url}`,
    meta: buildProjectMeta(context, projectId),
    structuredContent: { ok: false, reason, connectUrl: url },
  });
}

/** Both dates or neither, start first, at most two years. */
function rangeProblem(args: RangeArgs): string | null {
  if (Boolean(args.startDate) !== Boolean(args.endDate)) {
    return "Provide both startDate and endDate, or neither.";
  }
  if (args.startDate && args.endDate) {
    if (args.startDate > args.endDate) {
      return "startDate must be on or before endDate.";
    }
    if (inclusiveGa4Days(args.startDate, args.endDate) > MAX_RANGE_DAYS) {
      return `The range can span at most ${MAX_RANGE_DAYS} days.`;
    }
  }
  return null;
}

/** Run one read: validate the range, answer the result, or turn an expected
 *  Umami failure into ok:false. */
export async function answer<T extends Record<string, unknown>>(
  args: RangeArgs,
  context: AuthContext,
  read: () => Promise<T>,
  text: (result: T) => string,
) {
  const problem = rangeProblem(args);
  if (problem) {
    return mcpResponse({
      text: problem,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { ok: false, reason: "invalid_request" },
    });
  }
  try {
    const result = await read();
    return mcpResponse({
      text: text(result),
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: result,
    });
  } catch (error) {
    return failureResponse(context, args.projectId, error);
  }
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe(
    "Inclusive YYYY-MM-DD date (UTC). Provide both startDate and endDate.",
  );

export const rangeShape = {
  projectId: projectIdSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
};

export const pageShape = {
  ...rangeShape,
  limit: z.number().int().min(1).max(1_000).optional().default(100),
  offset: z.number().int().min(0).max(10_000).optional().default(0),
};

export const channelSchema = (fallback: "organic_search" | "all") =>
  z
    .enum(["organic_search", "all"])
    .optional()
    .default(fallback)
    .describe(
      "organic_search keeps visits referred by a search engine; all includes every source.",
    );

export const compareSchema = z
  .boolean()
  .optional()
  .default(false)
  .describe("Add each row's values for the previous equal-length period.");

export const outputSchema = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  connectUrl: z.string().optional(),
  source: z.looseObject({}).optional(),
  request: z.looseObject({}).optional(),
  organicDetection: z.looseObject({}).nullable().optional(),
  rows: z.array(z.looseObject({})).optional(),
  hasMore: z.boolean().optional(),
  ...optionalMetaOutputSchema,
});

const percent = (value: unknown) =>
  typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";

type Described = {
  request: { dateRange: { startDate: string; endDate: string } };
  organicDetection: { referrerDomains: string[] } | null;
};

export function rangeLine(label: string, result: Described): string {
  const { startDate, endDate } = result.request.dateRange;
  const organic = result.organicDetection
    ? result.organicDetection.referrerDomains.length > 0
      ? ` Organic = referrers ${result.organicDetection.referrerDomains.slice(0, 8).join(", ")}${result.organicDetection.referrerDomains.length > 8 ? ", …" : ""}.`
      : " No search engine referred visits in this period, so organic is empty."
    : "";
  return `${label}, ${startDate} through ${endDate} (UTC).${organic}`;
}

type BreakdownResult = Awaited<
  ReturnType<typeof UmamiReportingService.getBreakdown>
>;
type BreakdownRow = BreakdownResult["rows"][number];

export function breakdownText(label: string, result: BreakdownResult): string {
  const more = result.hasMore
    ? " More rows are available; call again with offset."
    : "";
  const summary = `${rangeLine(label, result)} ${result.rows.length} row(s).${more}`;
  if (result.rows.length === 0) return summary;
  const columns: McpTableColumn<BreakdownRow>[] =
    result.detail === "basic"
      ? [
          { header: "name", value: (row) => row.name },
          { header: "count", value: (row) => row.count },
        ]
      : [
          { header: "name", value: (row) => row.name },
          { header: "visitors", value: (row) => row.visitors },
          { header: "visits", value: (row) => row.visits },
          { header: "views", value: (row) => row.pageviews },
          {
            header: "bounce rate",
            value: (row) => row.bounceRate,
            format: percent,
          },
          { header: "avg visit (s)", value: (row) => row.avgVisitSeconds },
          ...(result.request.comparePreviousPeriod
            ? [
                {
                  header: "prev visitors",
                  value: (row: BreakdownRow) => row.previous?.visitors,
                },
              ]
            : []),
        ];
  return `${summary}\n${formatMcpTable(result.rows, columns)}`;
}
