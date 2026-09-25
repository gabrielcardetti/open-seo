/**
 * The content-guideline phase: runs after the crawl, judges a sample of pages
 * against the catalog, and records a verdict per page, plus one verdict for the
 * site as a whole (see siteAuditWorkflowGuidelinesSite.ts).
 *
 * Shaped like the Lighthouse phase, for the same reasons — it is the other
 * optional, per-page, externally-metered phase in this workflow. Waves of a few
 * URLs, one non-retrying step per page (a replay must not re-issue judge calls
 * that were already answered), one retrying step per wave for persistence.
 *
 * The sample is chosen first, so the site pass keeps cluster membership for
 * exactly the pages that will ask for it.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { CATALOG_VERSION } from "@/shared/guidelines/catalog";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import {
  DEFAULT_GUIDELINES_SAMPLE,
  selectGuidelinesSample,
} from "@/server/lib/guidelines/sample";
import type { AuditConfig } from "@/server/lib/audit/types";
import { pgStep } from "./pgStep";
import {
  DB_STEP,
  GUIDELINES_EVAL_STEP,
  GUIDELINES_PERSIST_STEP,
} from "./auditStepConfigs";
import {
  errorMessage,
  persistSitePass,
  runSitePass,
  summarizePage,
  type PageSummary,
  type SitePass,
} from "./siteAuditWorkflowGuidelinesSite";

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
  /** False when the crawl stopped at its page limit: absence is not evidence. */
  crawlCompleted: boolean;
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
  businessOverview: string | null;
  site: SitePass | null;
}) {
  const [
    { fetchPageForEvaluation },
    { evaluatePage },
    { resolveJudges },
    { siteContextFor },
  ] = await Promise.all([
    import("@/server/lib/guidelines/page-fetch"),
    import("@/server/lib/guidelines/page-evaluator"),
    import("@/server/lib/guidelines/judge-config"),
    import("@/server/lib/guidelines/site-evaluator"),
  ]);

  const page = await fetchPageForEvaluation(input.url);
  const judges = await resolveJudges();
  const evaluation = await evaluatePage({
    page,
    businessOverview: input.businessOverview,
    decisionJudge: judges.decisionJudge,
    languageJudge: judges.languageJudge,
    // The crawled URL, not the fetch's final one: it is what the clusters
    // list as members.
    siteContext: input.site
      ? siteContextFor(input.site.facts, input.site.evaluation, input.url)
      : null,
  });
  return { pageId: input.pageId, evaluation };
}

export async function runGuidelinesPhase(
  step: WorkflowStep,
  params: GuidelinesPhaseParams,
): Promise<void> {
  const { auditId, workflowInstanceId, projectId, startUrl, config } = params;
  if (config.guidelinesStrategy === "none") return;

  const sample = await pgStep(
    step,
    "select-guidelines-sample",
    DB_STEP,
    async () => {
      // The inventory carries the body hash, so identical pages get one
      // verdict instead of one each.
      const pages =
        await GuidelineEvaluationRepository.getSiteInventory(auditId);
      const selected = selectGuidelinesSample(
        pages,
        startUrl,
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

  const site = await runSitePass(step, {
    auditId,
    startUrl,
    crawlCompleted: params.crawlCompleted,
    businessOverview,
    sampledUrls: sample.map((page) => page.url),
  });

  // Pages of the clusters the site pass flagged, when the sample missed them:
  // doorway pages are short, and the sampler takes each template's longest.
  const flagged = site
    ? await pgStep(
        step,
        "guidelines-flagged-cluster-pages",
        DB_STEP,
        async () => {
          const { flaggedClusterPages } =
            await import("@/server/lib/guidelines/site-evaluator");
          const wanted = new Set(
            flaggedClusterPages(
              site.facts,
              site.evaluation,
              sample.map((page) => page.url),
            ),
          );
          if (wanted.size === 0) return [];
          const inventory =
            await GuidelineEvaluationRepository.getSiteInventory(auditId);
          return inventory
            .filter((page) => wanted.has(page.url))
            .map((page) => ({ pageId: page.id, url: page.url }));
        },
      )
    : [];
  const toJudge = [...sample, ...flagged];
  const pages: PageSummary[] = [];

  for (
    let waveStart = 0;
    waveStart < toJudge.length;
    waveStart += GUIDELINES_CONCURRENCY
  ) {
    const wave = toJudge.slice(waveStart, waveStart + GUIDELINES_CONCURRENCY);
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
              businessOverview,
              site,
            }),
        ),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        pages.push(summarizePage(outcome.value.evaluation));
      }
    }

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
            errorMessage: errorMessage(outcome.reason),
          });
        }
        return {
          evaluated: succeeded.length,
          failed: outcomes.length - succeeded.length,
        };
      },
    );
  }

  if (site) await persistSitePass(step, { auditId, site, pages });
}
