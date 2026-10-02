import { z } from "zod";
import { AuditComparisonRepository } from "@/server/features/audit/repositories/AuditComparisonRepository";
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
import {
  auditEngines,
  resolveAudit,
} from "@/server/mcp/tools/guideline-tool-support";
import type { Engine } from "@/shared/guidelines/engines";
import { verdictsByEngine } from "@/shared/guidelines/engine-verdicts";

/** URL lists are capped in the response; counts are always exact. */
const MAX_LISTED = 50;
/** Template rows in the text answer; the full list is in structuredContent. */
const MAX_TEMPLATE_LINES = 20;

const inputSchema = {
  projectId: projectIdSchema,
  baseAuditId: z.string().describe("The earlier audit (the 'before')."),
  auditId: z
    .string()
    .optional()
    .describe("The later audit (the 'after'). Omit for the most recent one."),
} as const;

type Args = { projectId: string; baseAuditId: string; auditId?: string };

/**
 * The latest successful verdict per page URL (a page can be judged more than
 * once), and the whole-site verdict apart: its URL is a sentinel, not a page.
 * Each engine's verdict is recomputed from the stored results (see
 * engine-verdicts.ts); Google's sit at the top level, Bing's beside them.
 */
async function guidelineVerdicts(audit: { id: string; config: string }) {
  const [rows, results] = await Promise.all([
    GuidelineEvaluationRepository.getEvaluationsForAudit(audit.id),
    GuidelineEvaluationRepository.getRuleResultsForAudit(audit.id),
  ]);
  const resultsOf = new Map<string, typeof results>();
  for (const result of results) {
    resultsOf.set(result.evaluationId, [
      ...(resultsOf.get(result.evaluationId) ?? []),
      result,
    ]);
  }
  const configured = auditEngines(audit);
  const perEngine = (engine: Engine) => {
    let siteVerdict: string | null = null;
    const latest = new Map<string, { verdict: string; at: string }>();
    for (const row of rows) {
      if (row.errorMessage || !row.verdict) continue;
      const verdict = verdictsByEngine(
        row,
        resultsOf.get(row.id) ?? [],
        configured,
      )[engine];
      if (!verdict) continue;
      if (row.pageType === "site") {
        siteVerdict = verdict;
        continue;
      }
      const at = String(row.evaluatedAt ?? "");
      const seen = latest.get(row.pageUrl);
      if (!seen || at > seen.at) latest.set(row.pageUrl, { verdict, at });
    }
    return {
      verdicts: new Map(Array.from(latest, ([url, v]) => [url, v.verdict])),
      siteVerdict,
    };
  };
  const bing = perEngine("bing");
  return {
    ...perEngine("google"),
    ...(bing.verdicts.size > 0 || bing.siteVerdict ? { bing } : {}),
  };
}

async function snapshot(audit: { id: string; config: string }) {
  const [pages, issues, guidelines] = await Promise.all([
    AuditComparisonRepository.getPageHashesForAudit(audit.id),
    AuditRepository.getIssuesForAudit(audit.id, {}),
    guidelineVerdicts(audit),
  ]);
  return {
    pageUrls: pages.map((page) => page.url),
    contentHashes: new Map(
      pages.flatMap((page) =>
        page.contentHash ? [[page.url, page.contentHash] as const] : [],
      ),
    ),
    issues,
    ...guidelines,
  };
}

export const compareAuditsTool = {
  name: "compare_audits",
  config: {
    title: "Compare two site audits",
    description:
      "Before/after between two audits of the same project: pages added and removed, pages whose visible text changed (pages.changed, matched by URL and content hash), each issue type's count with how many were resolved and how many are new (matched by issue type and URL), and content-guideline verdict counts with the pages that improved or worsened, plus the whole-site guideline verdict before and after — Google's at the top of `guidelines`, Bing's side by side in `guidelines.bing` when either audit was judged against Bing's guidelines (null otherwise). issues.common repeats the issue comparison on only the URLs both audits crawled — overall, by type and by URL template — so pages that entered or left the crawl sample don't read as fixes or regressions; prefer it when the page sets differ. Use it after deploying fixes and re-running run_site_audit to see what actually moved. Free — reads OpenSEO state.",
    inputSchema,
    outputSchema: z
      .object({
        pages: z.looseObject({
          added: z.array(z.string()),
          removed: z.array(z.string()),
          changed: z.array(z.string()),
          addedCount: z.number(),
          removedCount: z.number(),
          changedCount: z.number(),
        }),
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
      snapshot(base),
      snapshot(current),
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
      `Pages: ${diff.pages.before} → ${diff.pages.after} (+${diff.pages.added.length}, -${diff.pages.removed.length}, ${diff.pages.changed.length} with changed content).`,
      `Issues: ${diff.issues.before} → ${diff.issues.after}.`,
      ...diff.issues.byType.map(
        (t) =>
          `- ${t.issueType}: ${t.before} → ${t.after} (resolved ${t.resolved}, new ${t.introduced})`,
      ),
      `On the ${diff.issues.common.urls} URLs both audits crawled: ${diff.issues.common.before} → ${diff.issues.common.after} issues.`,
      ...diff.issues.common.byType.map(
        (t) =>
          `- ${t.issueType}: ${t.before} → ${t.after} (resolved ${t.resolved}, new ${t.introduced})`,
      ),
      "By URL template, same URLs (most changed first):",
      ...diff.issues.common.byTemplate
        .filter((t) => t.resolved + t.introduced > 0)
        .slice(0, MAX_TEMPLATE_LINES)
        .map(
          (t) =>
            `- ${t.issueType} on ${t.template}: ${t.before} → ${t.after} (resolved ${t.resolved}, new ${t.introduced})`,
        ),
      `Guideline verdicts: ${JSON.stringify(diff.guidelines.before)} → ${JSON.stringify(diff.guidelines.after)}; improved ${diff.guidelines.improved.length}, worsened ${diff.guidelines.worsened.length}.`,
      ...(diff.guidelines.site.before || diff.guidelines.site.after
        ? [
            `Whole-site guideline verdict: ${diff.guidelines.site.before ?? "none"} → ${diff.guidelines.site.after ?? "none"}.`,
          ]
        : []),
      ...(diff.guidelines.bing
        ? [
            `Bing guideline verdicts: ${JSON.stringify(diff.guidelines.bing.before)} → ${JSON.stringify(diff.guidelines.bing.after)}; improved ${diff.guidelines.bing.improved.length}, worsened ${diff.guidelines.bing.worsened.length}; whole site ${diff.guidelines.bing.site.before ?? "none"} → ${diff.guidelines.bing.site.after ?? "none"}.`,
          ]
        : []),
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
          changed: diff.pages.changed.slice(0, MAX_LISTED),
          addedCount: diff.pages.added.length,
          removedCount: diff.pages.removed.length,
          changedCount: diff.pages.changed.length,
        },
        issues: {
          ...diff.issues,
          common: {
            ...diff.issues.common,
            byTemplate: diff.issues.common.byTemplate.slice(0, MAX_LISTED),
            byTemplateCount: diff.issues.common.byTemplate.length,
          },
        },
        guidelines: {
          ...diff.guidelines,
          improved: diff.guidelines.improved.slice(0, MAX_LISTED),
          worsened: diff.guidelines.worsened.slice(0, MAX_LISTED),
          bing: diff.guidelines.bing && {
            ...diff.guidelines.bing,
            improved: diff.guidelines.bing.improved.slice(0, MAX_LISTED),
            worsened: diff.guidelines.bing.worsened.slice(0, MAX_LISTED),
          },
        },
      },
    });
  }),
};
