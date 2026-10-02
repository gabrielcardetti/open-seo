/**
 * Reading the content-guideline evaluation over MCP.
 *
 * The tools that let an agent DO the judging live in guideline-judge-tools.ts.
 */
import { z } from "zod";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import {
  CATALOG_VERSION,
  ENGINES,
  RULES_BY_ID,
  type Engine,
  type Verdict,
} from "@/shared/guidelines/catalog";
import {
  conflictNote,
  verdictsByEngine,
} from "@/shared/guidelines/engine-verdicts";
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
  engine: z
    .enum(ENGINES)
    .optional()
    .describe(
      "Whose verdicts `verdict` filters on and `summary` counts: google or bing. Defaults to Google when the audit was judged against Google's guidelines, else Bing. Every page still reports its verdict for each engine it was judged for.",
    ),
  verdict: z
    .enum(["pass", "pass_with_warnings", "revise", "reject"])
    .optional()
    .describe(
      "Only return pages with this verdict for `engine`. The whole-site verdict is always returned.",
    ),
  limit: z.number().int().min(1).max(500).optional().default(100),
};

type ResultsArgs = {
  projectId: string;
  auditId?: string;
  engine?: Engine;
  verdict?: Verdict;
  limit: number;
};

const ENGINE_LABEL: Record<Engine, string> = { google: "Google", bing: "Bing" };

function countVerdicts(verdicts: ReadonlyArray<Verdict | undefined>) {
  const counts = { pass: 0, pass_with_warnings: 0, revise: 0, reject: 0 };
  for (const verdict of verdicts) if (verdict) counts[verdict] += 1;
  return counts;
}

export const getGuidelineResultsTool = {
  name: "get_guideline_results",
  config: {
    title: "Get content guideline verdicts",
    description:
      "Read per-page verdicts from a site audit's content-guideline evaluation: which pages pass the search engines' official content guidelines (Google's, and Bing's when the audit asked for them), which rules they fail, the evidence, and the remediation for each. Each page has a verdict per engine it was judged for (`verdicts`), side by side; `verdict` and `summary` follow `engine`. A rule both engines state is judged once and lists both in `engines`. A rule where Bing and Google disagree reads as status `conflict` with a note, and never blocks a page. `site` is the whole-site verdict (doorway and scaled-content patterns, topical focus, trust pages, robots.txt for Bingbot), judged from the crawl inventory; it is not a page and is not counted in `summary`. Free — reads OpenSEO state. Omit auditId for the most recent audit.",
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
    const verdictsOf = new Map(
      data.evaluations.map((evaluation) => [
        evaluation.id,
        verdictsByEngine(
          evaluation,
          byEvaluation.get(evaluation.id) ?? [],
          data.engines,
        ),
      ]),
    );
    const judgedEngines = ENGINES.filter((engine) =>
      [...verdictsOf.values()].some((verdicts) => verdicts[engine]),
    );
    const engine =
      args.engine ?? (judgedEngines.includes("google") ? "google" : "bing");

    const describe = (evaluation: (typeof data.evaluations)[number]) => {
      const verdicts = verdictsOf.get(evaluation.id) ?? {};
      return {
        url: evaluation.pageUrl,
        verdict: verdicts[engine] ?? null,
        verdicts,
        ymyl: evaluation.ymyl,
        page_type: evaluation.pageType,
        unanswered_rules: evaluation.unknownCount,
        judged_by: evaluation.judge,
        findings: (byEvaluation.get(evaluation.id) ?? [])
          .filter((result) => result.status !== "unknown")
          .map((result) => {
            const rule = RULES_BY_ID.get(result.ruleId);
            const conflict = conflictNote(result.ruleId);
            return {
              rule: result.ruleId,
              rule_name: rule?.name ?? result.ruleId,
              engines: rule?.engines ?? [],
              // A rule the engines disagree on is information, not a fault.
              status: conflict ? "conflict" : result.status,
              severity: conflict ? "info" : result.severity,
              ...(conflict ? { note: conflict } : {}),
              evidence: result.evidence,
              reason: result.reason,
              how_to_fix: result.remediation,
              sources: (rule?.sources ?? []).map((source) => ({
                engine: source.engine,
                url: source.source_url,
              })),
            };
          }),
      };
    };

    // The site row's URL is a sentinel (`<origin>/#site`), not a page: it is
    // reported on its own and kept out of the per-page counts.
    const siteRow = data.evaluations.find((e) => e.pageType === "site");
    const pageRows = data.evaluations.filter((e) => e.pageType !== "site");
    const filtered = args.verdict
      ? pageRows.filter((e) => verdictsOf.get(e.id)?.[engine] === args.verdict)
      : pageRows;
    const pages = filtered.slice(0, args.limit).map(describe);

    const byEngine = Object.fromEntries(
      judgedEngines.map((judged) => [
        judged,
        countVerdicts(pageRows.map((e) => verdictsOf.get(e.id)?.[judged])),
      ]),
    );
    const siteVerdicts = siteRow ? (verdictsOf.get(siteRow.id) ?? {}) : {};

    return mcpResponse({
      structuredContent: {
        site: siteRow ? describe(siteRow) : null,
        pages,
        summary: {
          evaluated: pageRows.length,
          catalog_version: CATALOG_VERSION,
          engine,
          ...countVerdicts(pageRows.map((e) => verdictsOf.get(e.id)?.[engine])),
          by_engine: byEngine,
        },
      },
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      text: [
        `Content guidelines, ${pageRows.length} pages evaluated (catalog ${CATALOG_VERSION}):`,
        ...judgedEngines.map((judged) => {
          const counts = byEngine[judged];
          const site = siteVerdicts[judged];
          return `- ${ENGINE_LABEL[judged]}: reject ${counts.reject}, revise ${counts.revise}, pass with warnings ${counts.pass_with_warnings}, pass ${counts.pass}${site ? `; whole site: ${site}` : ""}`;
        }),
      ].join("\n"),
    });
  }),
};
