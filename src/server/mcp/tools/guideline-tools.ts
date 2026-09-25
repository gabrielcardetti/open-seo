/**
 * Reading the content-guideline evaluation over MCP.
 *
 * The tools that let an agent DO the judging live in guideline-judge-tools.ts.
 */
import { z } from "zod";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import { CATALOG_VERSION, RULES_BY_ID } from "@/shared/guidelines/catalog";
import {
  auditIdSchema,
  auditPath,
  resolveAudit,
} from "@/server/mcp/tools/guideline-tool-support";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

// ─── Read the evaluation ────────────────────────────────────────────────────

const resultsInputSchema = {
  projectId: projectIdSchema,
  auditId: auditIdSchema,
  verdict: z
    .enum(["pass", "pass_with_warnings", "revise", "reject"])
    .optional()
    .describe(
      "Only return pages with this verdict. The whole-site verdict is always returned.",
    ),
  limit: z.number().int().min(1).max(500).optional().default(100),
};

type ResultsArgs = {
  projectId: string;
  auditId?: string;
  verdict?: "pass" | "pass_with_warnings" | "revise" | "reject";
  limit: number;
};

export const getGuidelineResultsTool = {
  name: "get_guideline_results",
  config: {
    title: "Get content guideline verdicts",
    description:
      "Read per-page verdicts from a site audit's content-guideline evaluation: which pages pass Google's official content guidelines, which rules they fail, the evidence, and the remediation for each. `site` is the whole-site verdict (doorway and scaled-content patterns, topical focus, trust pages), judged from the crawl inventory; it is not a page and is not counted in `summary`. Free — reads OpenSEO state. Omit auditId for the most recent audit.",
    inputSchema: resultsInputSchema,
    outputSchema: z
      .object({
        site: looseObjectOutputSchema.nullable().optional(),
        pages: z.array(looseObjectOutputSchema),
        summary: looseObjectOutputSchema,
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ResultsArgs, context) => {
    const audit = await resolveAudit(args.projectId, args.auditId);
    const data =
      await GuidelineEvaluationRepository.getEvaluationResultsForProject(
        audit.id,
        args.projectId,
      );
    if (!data || data.evaluations.length === 0) {
      return mcpResponse({
        structuredContent: { pages: [], summary: { evaluated: 0 } },
        meta: buildProjectMeta(
          context,
          args.projectId,
          auditPath(args.projectId, audit.id),
        ),
        text: "This audit has no content-guideline evaluation. Start an audit with guidelinesStrategy set to run one.",
      });
    }

    const byEvaluation = new Map<string, typeof data.results>();
    for (const result of data.results) {
      const bucket = byEvaluation.get(result.evaluationId);
      if (bucket) bucket.push(result);
      else byEvaluation.set(result.evaluationId, [result]);
    }

    const describe = (evaluation: (typeof data.evaluations)[number]) => ({
      url: evaluation.pageUrl,
      verdict: evaluation.verdict,
      ymyl: evaluation.ymyl,
      page_type: evaluation.pageType,
      unanswered_rules: evaluation.unknownCount,
      judged_by: evaluation.judge,
      findings: (byEvaluation.get(evaluation.id) ?? [])
        .filter((result) => result.status !== "unknown")
        .map((result) => ({
          rule: result.ruleId,
          rule_name: RULES_BY_ID.get(result.ruleId)?.name ?? result.ruleId,
          status: result.status,
          severity: result.severity,
          evidence: result.evidence,
          reason: result.reason,
          how_to_fix: result.remediation,
          source: RULES_BY_ID.get(result.ruleId)?.source_url,
        })),
    });

    // The site row's URL is a sentinel (`<origin>/#site`), not a page: it is
    // reported on its own and kept out of the per-page counts.
    const siteRow = data.evaluations.find((e) => e.pageType === "site");
    const pageRows = data.evaluations.filter((e) => e.pageType !== "site");
    const filtered = args.verdict
      ? pageRows.filter((e) => e.verdict === args.verdict)
      : pageRows;
    const pages = filtered.slice(0, args.limit).map(describe);

    const counts = { pass: 0, pass_with_warnings: 0, revise: 0, reject: 0 };
    for (const evaluation of pageRows) {
      counts[evaluation.verdict] += 1;
    }

    return mcpResponse({
      structuredContent: {
        site: siteRow ? describe(siteRow) : null,
        pages,
        summary: {
          evaluated: pageRows.length,
          catalog_version: CATALOG_VERSION,
          ...counts,
        },
      },
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      text: [
        ...(siteRow ? [`Whole site: ${siteRow.verdict}`] : []),
        `Content guidelines, ${pageRows.length} pages evaluated (catalog ${CATALOG_VERSION}):`,
        `- reject: ${counts.reject}`,
        `- revise: ${counts.revise}`,
        `- pass with warnings: ${counts.pass_with_warnings}`,
        `- pass: ${counts.pass}`,
      ].join("\n"),
    });
  }),
};
