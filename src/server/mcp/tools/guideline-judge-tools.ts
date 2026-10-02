/**
 * The externalized judge: MCP tools that move the judging to the caller.
 *
 * Instead of OpenSEO paying a model to evaluate pages,
 * `get_guidelines_evaluation_batch` hands the connected agent everything it
 * needs — the page, the rules that apply to it, the answer format — and
 * `submit_guidelines_evaluation` (guideline-submit-tool.ts) takes the verdicts
 * back. The judging then runs on the caller's own subscription, with whatever
 * frontier model they already pay for, and the audit costs nothing to
 * evaluate.
 *
 * The whole site is one more item, under its sentinel URL (`<origin>/#site`):
 * the rules no single page can answer, judged from the crawl inventory. It
 * goes through the same site evaluator as the workflow's own site judge, and
 * once it is stored, pages submitted after it take its pattern answers into
 * account exactly as the workflow's pages do.
 */
import { z } from "zod";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import type { GuidelineRule } from "@/shared/guidelines/catalog";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { guidelineEnginesSchema, projectIdSchema } from "@/server/mcp/schemas";
import {
  auditEngines,
  auditIdSchema,
  auditPath,
  coversEngines,
  loadSiteInputs,
  pageContext,
  resolveAudit,
  siteBatchItem,
  siteFactsFor,
  storedSiteEvaluation,
} from "@/server/mcp/tools/guideline-tool-support";
import type { Engine } from "@/shared/guidelines/engines";

const batchInputSchema = {
  projectId: projectIdSchema,
  auditId: auditIdSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(3)
    .describe("How many pages to hand back. Each is a sizeable block of text."),
  strategy: z
    .enum(["sample", "all"])
    .optional()
    .default("sample")
    .describe(
      '"sample" (default) judges one page per URL template, up to 30. "all" judges every indexable 2xx page, for a full-site evaluation.',
    ),
  urls: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      "Hand back exactly these crawled URLs (when still eligible and unjudged). Lets several judges split one audit without taking the same pages. Include the site's sentinel URL (`<origin>/#site`) to take the whole-site item.",
    ),
  engines: guidelineEnginesSchema.describe(
    'Whose rules to hand out: ["google"], ["google","bing"] or ["bing"]. Defaults to the engines the audit was started with (Google unless run_site_audit asked for Bing). A page already judged for some engines is handed out again for the others; pass the same engines to submit_guidelines_evaluation.',
  ),
};

type BatchArgs = {
  projectId: string;
  auditId?: string;
  limit: number;
  strategy: "sample" | "all";
  urls?: string[];
  engines?: Engine[];
};

export const getGuidelinesEvaluationBatchTool = {
  name: "get_guidelines_evaluation_batch",
  config: {
    title: "Get pages to judge against the content guidelines",
    description:
      "Hand back crawled pages that still need a content-guideline verdict. `rules` lists each rule's question, the engines whose guidelines state it, and the engine's own pass/fail criteria once; each page's `rule_ids` says which of them apply to it. `engines` picks Google's rules (default), Bing's, or both. YOU judge them with your own model, then call submit_guidelines_evaluation with the verdicts. Free — this spends no OpenSEO credits, which is the point: the judging runs on your subscription. Quote the page's own words as evidence for every fail, and answer 'unknown' rather than guessing when the page does not show enough to decide. Until the whole site has a verdict, the batch also carries a `site` item: the crawl inventory (URL templates, clusters of look-alike pages C1, C2..., a sample of titles) with the site-level rules (doorways, scaled content, topical focus, trust pages). Judge it first and submit it under its sentinel URL, because pages submitted after it take its answers into account. For the site, evidence is the inventory's own URLs, titles, title patterns or cluster ids, and every finding cites the clusters it rests on in `clusters`.",
    inputSchema: batchInputSchema,
    outputSchema: z
      .object({
        rules: z.array(looseObjectOutputSchema).optional(),
        pages: z.array(looseObjectOutputSchema),
        response_format: looseObjectOutputSchema,
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: BatchArgs, context) => {
    const audit = await resolveAudit(args.projectId, args.auditId);
    const configured = auditEngines(audit);
    const engines = args.engines ?? configured;
    const [site, judged] = await Promise.all([
      loadSiteInputs(args.projectId, audit, engines),
      GuidelineEvaluationRepository.getJudgedUrls(audit.id),
    ]);
    // Judged already, for every engine asked for now.
    const alreadyDone = new Set(
      [...judged]
        .filter(([, ruleIds]) => coversEngines(ruleIds, engines, configured))
        .map(([url]) => url),
    );

    const { selectGuidelinesSample } =
      await import("@/server/lib/guidelines/sample");
    // The inventory carries the body hash, so identical pages get one verdict
    // instead of one each, as in the workflow.
    const sample = selectGuidelinesSample(
      site.pages,
      audit.startUrl,
      args.urls ? "all" : args.strategy,
    )
      .filter(
        (page) =>
          !alreadyDone.has(page.url) &&
          (!args.urls || args.urls.includes(page.url)),
      )
      .slice(0, args.limit);
    const facts = await siteFactsFor(
      site,
      sample.map((page) => page.url),
    );
    const { businessOverview } = site;
    // Only while no model has judged the site, and only for the judge that
    // asked for it when several split the audit by URL.
    const wantsSite =
      !alreadyDone.has(facts.sentinelUrl) &&
      (!args.urls || args.urls.includes(facts.sentinelUrl));

    if (sample.length === 0 && !wantsSite) {
      return mcpResponse({
        structuredContent: { pages: [], response_format: {} },
        meta: buildProjectMeta(
          context,
          args.projectId,
          auditPath(args.projectId, audit.id),
        ),
        text: "Every sampled page in this audit, and the site as a whole, already has a judged verdict.",
      });
    }

    const { fetchPageForEvaluation } =
      await import("@/server/lib/guidelines/page-fetch");
    const { planEvaluation } =
      await import("@/server/lib/guidelines/page-evaluator");
    const { renderPageState } = await import("@/server/lib/guidelines/judge");
    const { siteContextFor } =
      await import("@/server/lib/guidelines/site-evaluator");

    const siteBatch = wantsSite
      ? await siteBatchItem(facts, businessOverview, engines)
      : null;
    const siteItem = siteBatch?.item ?? null;
    const rulesInBatch = new Map<string, GuidelineRule>(
      (siteBatch?.rules ?? []).map((rule) => [rule.id, rule]),
    );

    // The site's stored answers, so each page's content says where it sits
    // (its template and clusters), as the workflow's page judges see it.
    const siteEvaluation =
      sample.length > 0
        ? await storedSiteEvaluation(audit.id, facts, engines)
        : null;
    const bwt = engines.includes("bing")
      ? await GuidelineEvaluationRepository.getBwtSnapshots(
          args.projectId,
          sample.map((page) => page.url),
        )
      : null;

    const batch = [];
    for (const target of sample) {
      let fetched;
      try {
        fetched = await fetchPageForEvaluation(target.url);
      } catch (error) {
        // Report it rather than silently skipping: a page that cannot be read
        // is a finding of its own.
        batch.push({
          url: target.url,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      // Only what is left for a judge: rules the page data settles (noindex,
      // rating markup with no reviews) are answered at submit, not asked.
      const { classification, askable } = planEvaluation(
        fetched,
        pageContext(facts, bwt?.[target.url]),
        engines,
      );
      for (const rule of askable) rulesInBatch.set(rule.id, rule);
      batch.push({
        // The crawled URL, not the post-redirect one: submit looks the page
        // up by the URL the audit recorded.
        url: target.url,
        page_type: classification.pageType,
        ymyl: classification.ymyl,
        ymyl_topics: classification.ymylTopics,
        content: renderPageState(
          fetched,
          undefined,
          siteEvaluation
            ? siteContextFor(facts, siteEvaluation, target.url)
            : null,
        ),
        rule_ids: askable.map((rule) => rule.id),
      });
    }

    return mcpResponse({
      structuredContent: {
        // Each rule's text once per batch, not once per page: the pages in a
        // batch mostly share the same ~70 rules, and repeating them made a
        // three-page batch four-fifths rule text.
        rules: Array.from(rulesInBatch.values(), (rule) => ({
          id: rule.id,
          engines: rule.engines,
          severity: rule.severity,
          question: rule.question,
          pass_if: rule.pass_if,
          fail_if: rule.fail_if,
        })),
        ...(siteItem ? { site: siteItem } : {}),
        pages: batch,
        response_format: {
          tool: "submit_guidelines_evaluation",
          results: [
            {
              url: "the page URL exactly as given (the site's sentinel URL for the site item)",
              findings: [
                {
                  ruleId: "e.g. PF-Q01",
                  status: "fail | warn | unknown",
                  evidence: "short quote from the page",
                  reason: "one sentence",
                  clusters: ["site item only: the cluster ids it rests on"],
                },
              ],
            },
          ],
          engines,
          note: "Report only rules that do NOT pass. Anything you omit counts as a pass. Do not invent policies beyond the rules supplied. A fail whose evidence is not a verbatim quote from the page is stored as a warning. Rules about a pattern across pages or about why a page was made: fail only when this page itself shows it, otherwise answer unknown.",
        },
      },
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      text:
        `${batch.length} page(s)${siteItem ? " and the whole-site item" : ""} ready to judge for audit ${audit.id}. ` +
        (siteItem
          ? `Judge the site item first and submit it under "${siteItem.url}". `
          : "") +
        `Evaluate each against its rules, then call submit_guidelines_evaluation with auditId "${audit.id}" and engines ${JSON.stringify(engines)}.`,
    });
  }),
};
