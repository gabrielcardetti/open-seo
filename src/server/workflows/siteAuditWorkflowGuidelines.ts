/**
 * The content-guideline phase: runs after the crawl, judges a sample of pages
 * against the catalog, and records a verdict per page.
 *
 * Shaped like the Lighthouse phase, for the same reasons — it is the other
 * optional, per-page, externally-metered phase in this workflow. Waves of a few
 * URLs, one non-retrying step per page (a replay must not re-issue judge calls
 * that were already answered), one retrying step per wave for persistence.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { CATALOG_VERSION } from "@/shared/guidelines/catalog";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import {
  DEFAULT_GUIDELINES_SAMPLE,
  selectGuidelinesSample,
  type GuidelinesSamplePage,
} from "@/server/lib/guidelines/sample";
import type { AuditConfig } from "@/server/lib/audit/types";
import { pgStep } from "./pgStep";
import {
  DB_STEP,
  GUIDELINES_EVAL_STEP,
  GUIDELINES_PERSIST_STEP,
} from "./auditStepConfigs";

/**
 * Pages judged concurrently. Each wave holds that many in-flight judge calls,
 * and the wave's results ride home in one step return, so this also bounds how
 * much state a single checkpoint carries.
 */
const GUIDELINES_CONCURRENCY = 4;

interface GuidelinesPhaseParams {
  auditId: string;
  workflowInstanceId: string;
  projectId: string;
  startUrl: string;
  config: AuditConfig;
}

/**
 * Judge one page.
 *
 * Imported lazily and inside the step: the evaluator pulls in the catalog JSON,
 * the HTML analyzer and the judges, and none of that belongs in the worker's
 * baseline heap (vite-plugin-lean-worker-bundle asserts the entry graph stays
 * lean). An audit that never turns this phase on never loads any of it.
 */
async function evaluateOnePage(input: {
  url: string;
  pageId: string;
  projectId: string;
  businessOverview: string | null;
}) {
  const [{ fetchPageForEvaluation }, { evaluatePage }, { resolveJudges }] =
    await Promise.all([
      import("@/server/lib/guidelines/page-fetch"),
      import("@/server/lib/guidelines/page-evaluator"),
      import("@/server/lib/guidelines/judge-config"),
    ]);

  const page = await fetchPageForEvaluation(input.url);
  const judges = await resolveJudges();
  const evaluation = await evaluatePage({
    page,
    businessOverview: input.businessOverview,
    decisionJudge: judges.decisionJudge,
    languageJudge: judges.languageJudge,
  });
  return { pageId: input.pageId, evaluation };
}

export async function runGuidelinesPhase(
  step: WorkflowStep,
  params: GuidelinesPhaseParams,
): Promise<void> {
  const { auditId, workflowInstanceId, projectId, config } = params;
  if (config.guidelinesStrategy === "none") return;

  const sample = await pgStep(
    step,
    "select-guidelines-sample",
    DB_STEP,
    async () => {
      const pages = await AuditRepository.getPagesForAudit(auditId);
      const candidates: GuidelinesSamplePage[] = pages.map((page) => ({
        id: page.id,
        url: page.url,
        statusCode: page.statusCode,
        isIndexable: page.isIndexable,
        fetchClass: page.fetchClass,
        wordCount: page.wordCount,
        // getPagesForAudit does not select the body hash; template grouping
        // and the per-template cap carry the deduplication instead.
        contentHash: null,
        crawlDepth: page.crawlDepth,
      }));
      const selected = selectGuidelinesSample(
        candidates,
        params.startUrl,
        config.guidelinesStrategy,
        DEFAULT_GUIDELINES_SAMPLE,
      );
      await AuditRepository.updateAuditProgress(auditId, workflowInstanceId, {
        currentPhase: "guidelines",
      });
      return selected;
    },
  );

  if (sample.length === 0) return;

  // Read once for the whole phase: it is the same for every page, and it is
  // what lets a judge answer "who is this page for?".
  const businessOverview = await pgStep(
    step,
    "guidelines-business-context",
    DB_STEP,
    async () => {
      const { ProjectContextRepository } =
        await import("@/server/features/project-context/repositories/ProjectContextRepository");
      const sections = await ProjectContextRepository.listSections(projectId);
      return (
        sections.find((section) => section.key === "business_overview")
          ?.content ?? null
      );
    },
  );

  for (
    let waveStart = 0;
    waveStart < sample.length;
    waveStart += GUIDELINES_CONCURRENCY
  ) {
    const wave = sample.slice(waveStart, waveStart + GUIDELINES_CONCURRENCY);
    const waveIndex = Math.floor(waveStart / GUIDELINES_CONCURRENCY) + 1;

    // allSettled, not all: a step that rejects must not orphan its siblings'
    // in-flight judge calls, which are the paid part of this phase.
    const outcomes = await Promise.allSettled(
      wave.map((page, offset) =>
        pgStep(
          step,
          `guidelines-eval-${waveStart + offset + 1}`,
          GUIDELINES_EVAL_STEP,
          () =>
            evaluateOnePage({
              url: page.url,
              pageId: page.pageId,
              projectId,
              businessOverview,
            }),
        ),
      ),
    );

    await pgStep(
      step,
      `guidelines-persist-${waveIndex}`,
      GUIDELINES_PERSIST_STEP,
      async () => {
        const succeeded = outcomes
          .filter((outcome) => outcome.status === "fulfilled")
          .map((outcome) => ({
            auditId,
            pageId: outcome.value.pageId,
            evaluation: outcome.value.evaluation,
          }));
        await GuidelineEvaluationRepository.insertEvaluations(succeeded);

        // A page that could not be judged is recorded as such. Silence would
        // read as "nothing to report", which is the opposite of the truth.
        for (const [offset, outcome] of outcomes.entries()) {
          if (outcome.status === "fulfilled") continue;
          const page = wave[offset];
          await GuidelineEvaluationRepository.insertFailedEvaluation({
            auditId,
            pageId: page.pageId,
            pageUrl: page.url,
            catalogVersion: CATALOG_VERSION,
            errorMessage:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason),
          });
        }
        return {
          evaluated: succeeded.length,
          failed: outcomes.length - succeeded.length,
        };
      },
    );
  }
}
