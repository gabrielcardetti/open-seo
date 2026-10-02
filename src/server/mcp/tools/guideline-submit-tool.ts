/**
 * The second half of the externalized judge (see guideline-judge-tools.ts):
 * `submit_guidelines_evaluation` takes back the verdicts a caller produced
 * from a batch.
 *
 * Submitted verdicts are untrusted input. They are checked against the catalog
 * before they are stored: a verdict on a rule that was never asked for that
 * page is rejected rather than written, the rules the page data settles are
 * answered here rather than by the caller, and the page's verdict is computed
 * from the catalog's severity rules rather than taken from the caller. A
 * caller judging one engine's rules keeps the page's stored answers for the
 * other engine.
 */
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import type { PageEvaluation } from "@/server/lib/guidelines/page-evaluator";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { guidelineEnginesSchema, projectIdSchema } from "@/server/mcp/schemas";
import {
  auditEngines,
  auditPath,
  judgeSite,
  keepOtherEngines,
  loadSiteInputs,
  pageContext,
  resolveAudit,
  siteFactsFor,
  sitePageResults,
  storedSiteEvaluation,
} from "@/server/mcp/tools/guideline-tool-support";
import type { Engine } from "@/shared/guidelines/engines";

const submitInputSchema = {
  projectId: projectIdSchema,
  auditId: z.string().describe("The audit these verdicts belong to."),
  judgeModel: z
    .string()
    .optional()
    .describe("Your model name, recorded for attribution (e.g. 'sonnet-5')."),
  results: z
    .array(
      z.object({
        url: z.string(),
        findings: z
          .array(
            z.object({
              ruleId: z.string(),
              status: z.enum(["fail", "warn", "unknown"]),
              evidence: z.string().optional(),
              reason: z.string().optional(),
              clusters: z
                .array(z.string())
                .max(10)
                .optional()
                .describe(
                  "Site item only: the cluster ids (C1, C2...) the finding rests on.",
                ),
            }),
          )
          .default([]),
      }),
    )
    .min(1)
    .max(10)
    .describe(
      "One entry per page judged, plus one under the site's sentinel URL for the whole-site item. Omit rules that pass.",
    ),
  engines: guidelineEnginesSchema.describe(
    "The engines the batch was handed out for (the same value you passed to get_guidelines_evaluation_batch; defaults to the audit's). Rules of those engines you omit count as passes; the page's stored answers for other engines are kept.",
  ),
};

type SubmitArgs = {
  projectId: string;
  auditId: string;
  engines?: Engine[];
  judgeModel?: string;
  results: Array<{
    url: string;
    findings: Array<{
      ruleId: string;
      status: "fail" | "warn" | "unknown";
      evidence?: string;
      reason?: string;
      clusters?: string[];
    }>;
  }>;
};

export const submitGuidelinesEvaluationTool = {
  name: "submit_guidelines_evaluation",
  config: {
    title: "Submit content guideline verdicts",
    description:
      "Store the verdicts you produced from get_guidelines_evaluation_batch. Pass the same `engines` as the batch. Each finding must name a rule that was supplied for that page; anything else is rejected. The per-page verdict (pass / pass_with_warnings / revise / reject) is computed from the catalog's own severity rules, not from you. Submit the whole-site item under its sentinel URL (`<origin>/#site`) with `clusters` on each finding; a doorway or scaled-content fail on the site then marks every page of the cited cluster, and can reject them.",
    inputSchema: submitInputSchema,
    outputSchema: z
      .object({
        stored: z.number(),
        rejected: z.array(z.string()),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: SubmitArgs, context) => {
    const audit = await resolveAudit(args.projectId, args.auditId);
    const engines = args.engines ?? auditEngines(audit);
    const [pages, site, previous] = await Promise.all([
      AuditRepository.getPagesForAudit(audit.id),
      loadSiteInputs(args.projectId, audit, engines),
      GuidelineEvaluationRepository.getRuleResultsForAudit(audit.id),
    ]);
    // Stored answers per URL, so judging one engine keeps the other's.
    const previousByUrl = new Map<string, typeof previous>();
    for (const result of previous) {
      previousByUrl.set(result.pageUrl, [
        ...(previousByUrl.get(result.pageUrl) ?? []),
        result,
      ]);
    }
    const facts = await siteFactsFor(
      site,
      args.results.map((result) => result.url),
    );
    const { businessOverview } = site;
    const pageByUrl = new Map(pages.map((page) => [page.url, page]));
    const judgeName = args.judgeModel ? `mcp:${args.judgeModel}` : "mcp";

    const { outcomesFromSubmission, planEvaluation, summarizeEvaluation } =
      await import("@/server/lib/guidelines/page-evaluator");
    const { fetchPageForEvaluation } =
      await import("@/server/lib/guidelines/page-fetch");
    const { finalizeSite, siteContextFor } =
      await import("@/server/lib/guidelines/site-evaluator");

    const rejected: string[] = [];
    const stored = [];

    // The site first: pages in the same submission then combine with the
    // answers just given rather than with an older (or no) site row.
    const siteResult = args.results.find(
      (result) => result.url === facts.sentinelUrl,
    );
    let siteEvaluation: PageEvaluation | null = null;
    if (siteResult) {
      const judged = await judgeSite({
        facts,
        businessOverview,
        modelId: judgeName,
        findings: siteResult.findings,
        engines,
      });
      for (const ruleId of judged.notAsked) {
        rejected.push(
          `${siteResult.url}: ${ruleId} was not asked for the site`,
        );
      }
      // SITE-04 is settled from the evaluated pages' bylines, as in the
      // workflow; without this a resubmitted site would lose it.
      siteEvaluation = finalizeSite(
        judged.evaluation,
        await sitePageResults(audit.id),
      );
      stored.push({
        auditId: audit.id,
        pageId: null,
        evaluation: await keepOtherEngines(
          siteEvaluation,
          previousByUrl.get(facts.sentinelUrl) ?? [],
          engines,
          "site",
        ),
      });
    } else {
      siteEvaluation = await storedSiteEvaluation(audit.id, facts, engines);
    }
    const bwt = engines.includes("bing")
      ? await GuidelineEvaluationRepository.getBwtSnapshots(
          args.projectId,
          args.results.map((result) => result.url),
        )
      : null;

    for (const result of args.results) {
      if (result === siteResult) continue;
      const page = pageByUrl.get(result.url);
      if (!page) {
        rejected.push(`${result.url}: not a page in this audit`);
        continue;
      }

      // Re-derive the plan rather than trusting the caller to have judged the
      // right set. It also runs the deterministic rules, so the stored verdict
      // matches what the audit's own judges would have recorded.
      let fetched;
      try {
        fetched = await fetchPageForEvaluation(result.url);
      } catch (error) {
        rejected.push(
          `${result.url}: could not re-read the page (${error instanceof Error ? error.message : "unknown"})`,
        );
        continue;
      }
      const plan = planEvaluation(
        fetched,
        pageContext(facts, bwt?.[result.url]),
        engines,
      );
      const { outcomes, notAsked } = outcomesFromSubmission(
        plan,
        fetched,
        result.findings,
        siteEvaluation
          ? siteContextFor(facts, siteEvaluation, result.url)
          : null,
      );
      for (const ruleId of notAsked) {
        rejected.push(`${result.url}: ${ruleId} was not asked for this page`);
      }

      const evaluation = summarizeEvaluation({
        page: fetched,
        classification: plan.classification,
        applicable: plan.applicable,
        outcomes,
        judge: judgeName,
      });
      stored.push({
        auditId: audit.id,
        pageId: page.id,
        // The crawled URL, which is what the audit's rows are keyed by.
        evaluation: await keepOtherEngines(
          { ...evaluation, url: result.url },
          previousByUrl.get(result.url) ?? [],
          engines,
        ),
      });
    }

    await GuidelineEvaluationRepository.insertEvaluations(stored);

    const storedPages = stored.length - (siteResult ? 1 : 0);
    return mcpResponse({
      structuredContent: { stored: stored.length, rejected },
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      text:
        `Stored ${storedPages} page verdict(s)` +
        (siteEvaluation && siteResult
          ? ` and the whole-site verdict (${siteEvaluation.verdict})`
          : "") +
        "." +
        (rejected.length > 0 ? ` Rejected: ${rejected.join("; ")}` : ""),
    });
  }),
};
