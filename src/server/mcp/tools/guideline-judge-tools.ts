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
 * before they are stored: a verdict on a rule that was never applicable to that
 * page is rejected rather than written, and the page's verdict is computed from
 * the catalog's severity rules rather than taken from the caller.
 */
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import {
  CATALOG_VERSION,
  RULES_BY_ID,
  computeVerdict,
  type GuidelineRule,
} from "@/shared/guidelines/catalog";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  applicableRulesFor,
  auditIdSchema,
  auditPath,
  resolveAudit,
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
      "Hand back exactly these crawled URLs (when still eligible and unjudged). Lets several judges split one audit without taking the same pages.",
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
      "Hand back crawled pages that still need a content-guideline verdict. `rules` lists each rule's question and Google's own pass/fail criteria once; each page's `rule_ids` says which of them apply to it. YOU judge them with your own model, then call submit_guidelines_evaluation with the verdicts. Free — this spends no OpenSEO credits, which is the point: the judging runs on your subscription. Quote the page's own words as evidence for every fail, and answer 'unknown' rather than guessing when the page does not show enough to decide.",
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
    const [pages, alreadyDone] = await Promise.all([
      AuditRepository.getPagesForAudit(audit.id),
      GuidelineEvaluationRepository.getJudgedUrls(audit.id),
    ]);

    const { selectGuidelinesSample } =
      await import("@/server/lib/guidelines/sample");
    const sample = selectGuidelinesSample(
      pages.map((page) => ({
        id: page.id,
        url: page.url,
        statusCode: page.statusCode,
        isIndexable: page.isIndexable,
        fetchClass: page.fetchClass,
        wordCount: page.wordCount,
        contentHash: null,
        crawlDepth: page.crawlDepth,
      })),
      audit.startUrl,
      args.urls ? "all" : args.strategy,
    ).filter(
      (page) =>
        !alreadyDone.has(page.url) &&
        (!args.urls || args.urls.includes(page.url)),
    );

    if (sample.length === 0) {
      return mcpResponse({
        structuredContent: { pages: [], response_format: {} },
        meta: buildProjectMeta(
          context,
          args.projectId,
          auditPath(args.projectId, audit.id),
        ),
        text: "Every sampled page in this audit already has a judged verdict.",
      });
    }

    const { fetchPageForEvaluation } =
      await import("@/server/lib/guidelines/page-fetch");
    const { classifyPage } =
      await import("@/server/lib/guidelines/page-evaluator");
    const { renderPageState } = await import("@/server/lib/guidelines/judge");

    const batch = [];
    const rulesInBatch = new Map<string, GuidelineRule>();
    for (const target of sample.slice(0, args.limit)) {
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
      const classification = classifyPage(fetched);
      const applicable = applicableRulesFor(classification);
      for (const rule of applicable) rulesInBatch.set(rule.id, rule);
      batch.push({
        // The crawled URL, not the post-redirect one: submit looks the page
        // up by the URL the audit recorded.
        url: target.url,
        page_type: classification.pageType,
        ymyl: classification.ymyl,
        ymyl_topics: classification.ymylTopics,
        content: renderPageState(fetched),
        rule_ids: applicable.map((rule) => rule.id),
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
        pages: batch,
        response_format: {
          tool: "submit_guidelines_evaluation",
          results: [
            {
              url: "the page URL exactly as given",
              findings: [
                {
                  ruleId: "e.g. PF-Q01",
                  status: "fail | warn | unknown",
                  evidence: "short quote from the page",
                  reason: "one sentence",
                },
              ],
            },
          ],
          note: "Report only rules that do NOT pass. Anything you omit counts as a pass. Do not invent policies beyond the rules supplied.",
        },
      },
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      text: `${batch.length} page(s) ready to judge for audit ${audit.id}. Evaluate each against its rules, then call submit_guidelines_evaluation with auditId "${audit.id}".`,
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
            }),
          )
          .default([]),
      }),
    )
    .min(1)
    .max(10)
    .describe("One entry per page judged. Omit rules that pass."),
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
    }>;
  }>;
};

export const submitGuidelinesEvaluationTool = {
  name: "submit_guidelines_evaluation",
  config: {
    title: "Submit content guideline verdicts",
    description:
      "Store the verdicts you produced from get_guidelines_evaluation_batch. Each finding must name a rule that was supplied for that page; anything else is rejected. The per-page verdict (pass / pass_with_warnings / revise / reject) is computed from the catalog's own severity rules, not from you.",
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
    const pages = await AuditRepository.getPagesForAudit(audit.id);
    const pageByUrl = new Map(pages.map((page) => [page.url, page]));

    const { classifyPage } =
      await import("@/server/lib/guidelines/page-evaluator");
    const { fetchPageForEvaluation } =
      await import("@/server/lib/guidelines/page-fetch");

    const rejected: string[] = [];
    const stored = [];

    for (const result of args.results) {
      const page = pageByUrl.get(result.url);
      if (!page) {
        rejected.push(`${result.url}: not a page in this audit`);
        continue;
      }

      // Re-derive which rules were applicable rather than trusting the caller
      // to have judged the right set.
      let classification;
      try {
        classification = classifyPage(await fetchPageForEvaluation(result.url));
      } catch (error) {
        rejected.push(
          `${result.url}: could not re-read the page (${error instanceof Error ? error.message : "unknown"})`,
        );
        continue;
      }
      const applicable = applicableRulesFor(classification);
      const applicableIds = new Set(applicable.map((rule) => rule.id));

      const findings: Array<{
        ruleId: string;
        status: "fail" | "warn" | "unknown";
        severity: "critical" | "high" | "medium" | "low";
        score: number | null;
        confidence: number | null;
        evidence: string | null;
        reason: string | null;
        remediation: string;
      }> = [];
      for (const finding of result.findings) {
        if (!applicableIds.has(finding.ruleId)) {
          rejected.push(
            `${result.url}: ${finding.ruleId} was not applicable to this page`,
          );
          continue;
        }
        const rule = RULES_BY_ID.get(finding.ruleId)!;
        findings.push({
          ruleId: finding.ruleId,
          status: finding.status,
          severity: rule.severity,
          score: null,
          confidence: null,
          evidence: finding.evidence?.slice(0, 1000) ?? null,
          reason: finding.reason?.slice(0, 1000) ?? null,
          // From the catalog, never from the caller.
          remediation: rule.remediation,
        });
      }

      // Rules the caller did not mention passed; rules nobody answered did not.
      const answered = new Set(findings.map((finding) => finding.ruleId));
      const outcomes = applicable.map((rule) => ({
        id: rule.id,
        status: answered.has(rule.id)
          ? findings.find((f) => f.ruleId === rule.id)!.status
          : ("pass" as const),
      }));
      const summary = computeVerdict(outcomes);

      stored.push({
        auditId: audit.id,
        pageId: page.id,
        evaluation: {
          url: result.url,
          catalogVersion: CATALOG_VERSION,
          classification,
          verdict: summary.verdict,
          criticalFails: summary.criticalFails,
          highFails: summary.highFails,
          mediumFails: summary.mediumFails,
          lowFails: summary.lowFails,
          unknownCount: findings.filter((f) => f.status === "unknown").length,
          judge: args.judgeModel ? `mcp:${args.judgeModel}` : "mcp",
          findings,
          applicableRuleIds: applicable.map((rule) => rule.id),
        },
      });
    }

    await GuidelineEvaluationRepository.insertEvaluations(stored);

    return mcpResponse({
      structuredContent: { stored: stored.length, rejected },
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      text:
        `Stored ${stored.length} page verdict(s).` +
        (rejected.length > 0 ? ` Rejected: ${rejected.join("; ")}` : ""),
    });
  }),
};
