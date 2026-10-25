import { sort } from "remeda";
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { urlTemplateOf } from "@/server/lib/audit/url-utils";
import {
  AUDIT_ISSUE_TYPES,
  getIssueDescriptor,
  ISSUE_SEVERITY_ORDER,
} from "@/shared/audit-issues";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { formatMcpCell } from "@/server/mcp/table";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  auditIdSchema,
  resolveAudit,
} from "@/server/mcp/tools/guideline-tool-support";

/** Example URLs listed per template group; the count is always exact. */
const GROUP_EXAMPLES = 3;

// Text-only clients read just the text block, so each issue type renders its
// remediation steps plus a bounded sample of affected URLs. Every URL of every
// type would be a data dump; the per-type count keeps the sample honest.
const ISSUE_SAMPLE_SIZE = 5;

/** Render an issue's parsed details record as ` (statusCode: 404, length: 12)`. */
function formatIssueDetails(details: unknown): string {
  if (typeof details !== "object" || details === null || Array.isArray(details))
    return "";
  const parts = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([key, value]) =>
        `${key}: ${
          Array.isArray(value)
            ? value.map(formatMcpCell).join(" → ")
            : formatMcpCell(value)
        }`,
    );
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

const issuesInputSchema = {
  projectId: projectIdSchema,
  auditId: auditIdSchema,
  severity: z
    .enum(["critical", "warning", "info"])
    .optional()
    .describe("Only return issues of this severity."),
  issueType: z
    .string()
    .optional()
    .describe(
      `Only return issues of this type. One of: ${Object.keys(AUDIT_ISSUE_TYPES).join(", ")}`,
    ),
  groupBy: z
    .enum(["template"])
    .optional()
    .describe(
      'Return one row per issue type and URL template (e.g. /bopv/:id/:id) with the page count and a few example URLs, instead of one row per page. Use it on large sites: an issue repeated across a template is usually fixed once, in the template, and the per-page list would hit the limit before showing other issue types. "(site)" groups issues that belong to no single page.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1_000)
    .optional()
    .describe("Max issues (or groups, with groupBy) to return (default 200)."),
} as const;

type IssuesArgs = z.infer<z.ZodObject<typeof issuesInputSchema>>;

type IssueRow = Awaited<
  ReturnType<typeof AuditRepository.getIssuesForAudit>
>[number];

function groupByTemplate(rows: readonly IssueRow[]) {
  const groups = new Map<
    string,
    {
      severity: IssueRow["severity"];
      issueType: string;
      template: string;
      count: number;
      exampleUrls: string[];
    }
  >();
  for (const row of rows) {
    const template = urlTemplateOf(row.pageUrl);
    const key = `${row.issueType}\u0000${template}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        severity: row.severity,
        issueType: row.issueType,
        template,
        count: 0,
        exampleUrls: [],
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (row.pageUrl && group.exampleUrls.length < GROUP_EXAMPLES) {
      group.exampleUrls.push(row.pageUrl);
    }
  }
  return sort(
    Array.from(groups.values()),
    (a, b) =>
      ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] ||
      b.count - a.count,
  ).map((group) => {
    const descriptor = getIssueDescriptor(group.issueType);
    return {
      ...group,
      title: descriptor?.title ?? group.issueType,
      howToFix: descriptor?.howToFix ?? null,
    };
  });
}

export const getAuditIssuesTool = {
  name: "get_audit_issues",
  config: {
    title: "Get site audit issues",
    description:
      'Read the prioritized issue report from a completed site audit. Every issue carries a how_to_fix with concrete remediation steps an agent can act on. Pass groupBy: "template" to get one row per issue type and URL template instead of one per page. Free — reads OpenSEO state. Omit auditId for the most recent audit.',
    inputSchema: issuesInputSchema,
    outputSchema: z
      .object({
        summary: z.array(looseObjectOutputSchema),
        issues: z.array(looseObjectOutputSchema).optional(),
        groups: z.array(looseObjectOutputSchema).optional(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: IssuesArgs, context) => {
    const audit = await resolveAudit(args.projectId, args.auditId);
    const unsorted = await AuditRepository.getIssuesForAudit(audit.id, {
      severity: args.severity,
      issueType: args.issueType,
    });
    // Severity-first so truncation drops info rows, never critical ones.
    const rows = sort(
      unsorted,
      (a, b) =>
        ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] ||
        a.issueType.localeCompare(b.issueType),
    );

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.issueType, (counts.get(row.issueType) ?? 0) + 1);
    }
    const summary = sort(
      Array.from(counts.entries()).map(([issueType, count]) => {
        const descriptor = getIssueDescriptor(issueType);
        return {
          issueType,
          title: descriptor?.title ?? issueType,
          severity: descriptor?.severity ?? "info",
          count,
        };
      }),
      (a, b) =>
        ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] ||
        b.count - a.count,
    );

    const limit = args.limit ?? 200;
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/audit?auditId=${audit.id}`,
    );
    const byType = [
      "By type:",
      ...summary.map(
        (entry) =>
          `- [${entry.severity}] ${entry.title} (${entry.issueType}): ${entry.count}`,
      ),
    ];

    if (rows.length === 0) {
      return mcpResponse({
        text:
          args.severity || args.issueType
            ? `No issues found for audit ${audit.id} matching the given filters.`
            : audit.status === "running"
              ? `Audit ${audit.id} is still running; issues are recorded when it finishes. Poll get_audit_status.`
              : `Audit ${audit.id} found no issues across ${audit.pagesCrawled} crawled page${audit.pagesCrawled === 1 ? "" : "s"}.`,
        meta,
        structuredContent: { summary, issues: [] },
      });
    }

    if (args.groupBy === "template") {
      const groups = groupByTemplate(rows);
      const shown = groups.slice(0, limit);
      return mcpResponse({
        text: [
          `Audit ${audit.id} (${audit.startUrl}): ${rows.length} issues in ${groups.length} type × template groups${groups.length > limit ? ` (showing ${limit})` : ""}.`,
          ...byType,
          "By template:",
          ...shown.map(
            (group) =>
              `- [${group.severity}] ${group.issueType} on ${group.template}: ${group.count} (e.g. ${group.exampleUrls.join(", ") || "—"})`,
          ),
          "Groups with how_to_fix instructions are in structuredContent.groups.",
        ].join("\n"),
        meta,
        structuredContent: { summary, groups: shown },
      });
    }

    const issues = rows.slice(0, limit).map((row) => {
      const descriptor = getIssueDescriptor(row.issueType);
      return {
        severity: row.severity,
        issueType: row.issueType,
        title: descriptor?.title ?? row.issueType,
        url: row.pageUrl,
        details: row.detailsJson
          ? (JSON.parse(row.detailsJson) as unknown)
          : null,
        howToFix: descriptor?.howToFix ?? null,
      };
    });

    // Sample affected URLs from the returned rows, keyed by issue type; counts
    // still come from `summary`, which covers every matching row.
    const samples = new Map<string, typeof issues>();
    for (const issue of issues) {
      const sample = samples.get(issue.issueType) ?? [];
      if (sample.length < ISSUE_SAMPLE_SIZE) sample.push(issue);
      samples.set(issue.issueType, sample);
    }
    let sampled = false;

    const sections = summary.map((entry) => {
      const shown = samples.get(entry.issueType) ?? [];
      const remaining = entry.count - shown.length;
      if (remaining > 0) sampled = true;
      const howToFix = getIssueDescriptor(entry.issueType)?.howToFix;
      return [
        `[${entry.severity}] ${entry.title} (${entry.issueType}): ${entry.count} affected page${entry.count === 1 ? "" : "s"}`,
        howToFix ? `  Fix: ${howToFix}` : null,
        ...shown.map(
          (issue) => `  - ${issue.url}${formatIssueDetails(issue.details)}`,
        ),
        // A low-severity type can fall entirely outside the limit-truncated
        // rows, leaving counts with no rows to sample from.
        shown.length === 0
          ? `  (no sample URLs within the first ${limit} issue rows — raise limit to see examples)`
          : remaining > 0
            ? `  …and ${remaining} more affected URL${remaining === 1 ? "" : "s"} in this issue.`
            : null,
      ]
        .filter((line) => line !== null)
        .join("\n");
    });

    return mcpResponse({
      text: [
        `Audit ${audit.id} (${audit.startUrl}): ${rows.length} issues across ${summary.length} issue type${summary.length === 1 ? "" : "s"}.`,
        ...sections,
        sampled
          ? `Up to ${ISSUE_SAMPLE_SIZE} affected URLs are listed per issue type — open the audit in the dashboard for the full list, or pass groupBy: "template" to group them by URL template.`
          : null,
        rows.length > limit
          ? `Structured issue rows are capped at the ${limit} highest-severity issues; raise limit (max 1000) for more.`
          : null,
      ]
        .filter((block) => block !== null)
        .join("\n\n"),
      meta,
      structuredContent: { summary, issues },
    });
  }),
};
