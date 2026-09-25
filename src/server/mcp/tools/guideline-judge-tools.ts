/**
 * The externalized judge: MCP tools that move the judging to the caller.
 *
 * Instead of OpenSEO paying a model to evaluate pages,
 * `get_guidelines_evaluation_batch` hands the connected agent everything it
 * needs — the page, the rules that apply to it, the answer format — and
 * `submit_guidelines_evaluation` takes the verdicts back. The judging then runs
 * on the caller's own subscription, with whatever frontier model they already
 * pay for, and the audit costs nothing to evaluate.
 *
 * Submitted verdicts are untrusted input. They are checked against the catalog
 * before they are stored: a verdict on a rule that was never asked for that
 * page is rejected rather than written, the rules the page data settles are
 * answered here rather than by the caller, and the page's verdict is computed
 * from the catalog's severity rules rather than taken from the caller.
 *
 * The whole site is one more item, under its sentinel URL (`<origin>/#site`):
 * the rules no single page can answer, judged from the crawl inventory. It
 * goes through the same site evaluator as the workflow's own site judge, and
 * once it is stored, pages submitted after it take its pattern answers into
 * account exactly as the workflow's pages do.
 */
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import type { PageEvaluation } from "@/server/lib/guidelines/page-evaluator";
import type { GuidelineRule } from "@/shared/guidelines/catalog";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  auditIdSchema,
  auditPath,
  judgeSite,
  loadSiteInputs,
  resolveAudit,
  siteBatchItem,
  siteFactsFor,
  sitePageResults,
  storedSiteEvaluation,
} from "@/server/mcp/tools/guideline-tool-support";

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
};

type BatchArgs = {
  projectId: string;
  auditId?: string;
  limit: number;
  strategy: "sample" | "all";
  urls?: string[];
};

export const getGuidelinesEvaluationBatchTool = {
  name: "get_guidelines_evaluation_batch",
  config: {
    title: "Get pages to judge against the content guidelines",
    description:
      "Hand back crawled pages that still need a content-guideline verdict. `rules` lists each rule's question and Google's own pass/fail criteria once; each page's `rule_ids` says which of them apply to it. YOU judge them with your own model, then call submit_guidelines_evaluation with the verdicts. Free — this spends no OpenSEO credits, which is the point: the judging runs on your subscription. Quote the page's own words as evidence for every fail, and answer 'unknown' rather than guessing when the page does not show enough to decide. Until the whole site has a verdict, the batch also carries a `site` item: the crawl inventory (URL templates, clusters of look-alike pages C1, C2..., a sample of titles) with the site-level rules (doorways, scaled content, topical focus, trust pages). Judge it first and submit it under its sentinel URL, because pages submitted after it take its answers into account. For the site, evidence is the inventory's own URLs, titles, title patterns or cluster ids, and every finding cites the clusters it rests on in `clusters`.",
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
    const [site, alreadyDone] = await Promise.all([
      loadSiteInputs(args.projectId, audit),
      GuidelineEvaluationRepository.getJudgedUrls(audit.id),
    ]);

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
      ? await siteBatchItem(facts, businessOverview)
      : null;
    const siteItem = siteBatch?.item ?? null;
    const rulesInBatch = new Map<string, GuidelineRule>(
      (siteBatch?.rules ?? []).map((rule) => [rule.id, rule]),
    );

    // The site's stored answers, so each page's content says where it sits
    // (its template and clusters), as the workflow's page judges see it.
    const siteEvaluation =
      sample.length > 0 ? await storedSiteEvaluation(audit.id, facts) : null;

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
      const { classification, askable } = planEvaluation(fetched);
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
        `Evaluate each against its rules, then call submit_guidelines_evaluation with auditId "${audit.id}".`,
    });
  }),
};

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
};

type SubmitArgs = {
  projectId: string;
  auditId: string;
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
      "Store the verdicts you produced from get_guidelines_evaluation_batch. Each finding must name a rule that was supplied for that page; anything else is rejected. The per-page verdict (pass / pass_with_warnings / revise / reject) is computed from the catalog's own severity rules, not from you. Submit the whole-site item under its sentinel URL (`<origin>/#site`) with `clusters` on each finding; a doorway or scaled-content fail on the site then marks every page of the cited cluster, and can reject them.",
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
    const [pages, site] = await Promise.all([
      AuditRepository.getPagesForAudit(audit.id),
      loadSiteInputs(args.projectId, audit),
    ]);
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
        evaluation: siteEvaluation,
      });
    } else {
      siteEvaluation = await storedSiteEvaluation(audit.id, facts);
    }

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
      const plan = planEvaluation(fetched);
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
        evaluation: { ...evaluation, url: result.url },
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
