import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import { compareAudits } from "@/server/lib/audit/compare";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { resolveAudit } from "@/server/mcp/tools/guideline-tool-support";

/** URL lists are capped in the response; counts are always exact. */
const MAX_LISTED = 50;

const inputSchema = {
  projectId: projectIdSchema,
  baseAuditId: z.string().describe("The earlier audit (the 'before')."),
  auditId: z
    .string()
    .optional()
    .describe("The later audit (the 'after'). Omit for the most recent one."),
} as const;

type Args = { projectId: string; baseAuditId: string; auditId?: string };

/** The latest successful verdict per URL; a page can be judged more than once. */
async function verdictsByUrl(auditId: string) {
  const rows =
    await GuidelineEvaluationRepository.getEvaluationsForAudit(auditId);
  const latest = new Map<string, { verdict: string; at: string }>();
  for (const row of rows) {
    if (row.errorMessage || !row.verdict) continue;
    const at = String(row.evaluatedAt ?? "");
    const seen = latest.get(row.pageUrl);
    if (!seen || at > seen.at) {
      latest.set(row.pageUrl, { verdict: row.verdict, at });
    }
  }
  return new Map(Array.from(latest, ([url, v]) => [url, v.verdict]));
}

async function snapshot(auditId: string) {
  const [pages, issues, verdicts] = await Promise.all([
    AuditRepository.getPagesForAudit(auditId),
    AuditRepository.getIssuesForAudit(auditId, {}),
    verdictsByUrl(auditId),
  ]);
  return { pageUrls: pages.map((page) => page.url), issues, verdicts };
}

export const compareAuditsTool = {
  name: "compare_audits",
  config: {
    title: "Compare two site audits",
    description:
      "Before/after between two audits of the same project: pages added and removed, each issue type's count with how many were resolved and how many are new (matched by issue type and URL), and content-guideline verdict counts with the pages that improved or worsened. Use it after deploying fixes and re-running run_site_audit to see what actually moved. Free — reads OpenSEO state.",
    inputSchema,
    outputSchema: z
      .object({
        pages: looseObjectOutputSchema,
        issues: looseObjectOutputSchema,
        guidelines: looseObjectOutputSchema,
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const [base, current] = await Promise.all([
      resolveAudit(args.projectId, args.baseAuditId),
      resolveAudit(args.projectId, args.auditId),
    ]);
    const [before, after] = await Promise.all([
      snapshot(base.id),
      snapshot(current.id),
    ]);
    const diff = compareAudits(before, after);
    // A crawl still in progress has fewer pages, so everything it has not
    // reached yet reads as "removed" or "resolved". Say so up front.
    const unfinished = [base, current].filter(
      (audit) => audit.status !== "completed",
    );
    const warning =
      unfinished.length > 0
        ? `Not comparable yet: ${unfinished.map((a) => `${a.id} is ${a.status}`).join(", ")}. Pages and issues not crawled yet show as removed or resolved; guideline verdicts are unaffected.`
        : null;

    const text = [
      ...(warning ? [warning] : []),
      `Audit ${base.id} (${base.startedAt}) → ${current.id} (${current.startedAt}).`,
      `Pages: ${diff.pages.before} → ${diff.pages.after} (+${diff.pages.added.length}, -${diff.pages.removed.length}).`,
      `Issues: ${diff.issues.before} → ${diff.issues.after}.`,
      ...diff.issues.byType.map(
        (t) =>
          `- ${t.issueType}: ${t.before} → ${t.after} (resolved ${t.resolved}, new ${t.introduced})`,
      ),
      `Guideline verdicts: ${JSON.stringify(diff.guidelines.before)} → ${JSON.stringify(diff.guidelines.after)}; improved ${diff.guidelines.improved.length}, worsened ${diff.guidelines.worsened.length}.`,
    ].join("\n");

    return mcpResponse({
      text,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: {
        warning,
        pages: {
          ...diff.pages,
          added: diff.pages.added.slice(0, MAX_LISTED),
          removed: diff.pages.removed.slice(0, MAX_LISTED),
          addedCount: diff.pages.added.length,
          removedCount: diff.pages.removed.length,
        },
        issues: diff.issues,
        guidelines: {
          ...diff.guidelines,
          improved: diff.guidelines.improved.slice(0, MAX_LISTED),
          worsened: diff.guidelines.worsened.slice(0, MAX_LISTED),
        },
      },
    });
  }),
};
