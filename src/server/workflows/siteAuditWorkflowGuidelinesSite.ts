/**
 * The site pass of the content-guideline phase: one verdict for the site as a
 * whole, judged from the crawl inventory.
 *
 * It runs before the page waves, so that every page judge knows "this page is
 * one of 214 in cluster C1" and a page in a doorway cluster the site judge
 * failed is rejected with it. Its row is stored last, because one of its rules
 * (SITE-04, real authors) is read off the page results.
 *
 * The site pass is additive: whatever goes wrong in it, including a database
 * that refuses its row, the page waves and the rest of the audit still run.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { CATALOG_VERSION, type RuleStatus } from "@/shared/guidelines/catalog";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import type { PageEvaluation } from "@/server/lib/guidelines/page-evaluator";
import type { SiteFacts } from "@/server/lib/guidelines/site-facts";
import { normalizeUrl } from "@/server/lib/audit/url-utils";
import { getAuditScratchpad } from "@/server/features/audit/AuditScratchpad";
import { pgStep } from "./pgStep";
import {
  DB_STEP,
  GUIDELINES_EVAL_STEP,
  GUIDELINES_PERSIST_STEP,
} from "./auditStepConfigs";

/** The site view every page is judged against. */
export interface SitePass {
  facts: SiteFacts;
  evaluation: PageEvaluation;
}

/** What the site row needs from one judged page. */
export interface PageSummary {
  pageType: string;
  who01Status: RuleStatus | null;
  ymylTopics: PageEvaluation["classification"]["ymylTopics"];
}

/** The rule SITE-04 is read off: whether the page names its author. */
const AUTHOR_RULE = "WHO-01";

export const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

export function summarizePage(evaluation: PageEvaluation): PageSummary {
  const asked = evaluation.applicableRuleIds.includes(AUTHOR_RULE);
  const finding = evaluation.findings.find(
    (candidate) => candidate.ruleId === AUTHOR_RULE,
  );
  return {
    pageType: evaluation.classification.pageType,
    // Only non-passing rules are stored as findings, so an asked rule with no
    // finding passed.
    who01Status: asked ? (finding?.status ?? "pass") : null,
    ymylTopics: evaluation.classification.ymylTopics,
  };
}

/**
 * The site's crawl inventory as the site judge reads it.
 *
 * Cluster members are kept only for the sampled URLs: they are the only pages
 * that ask which cluster they sit in, and the facts ride home in a step return.
 *
 * The homepage's links come from the crawl scratchpad, which is still alive
 * here (finalize destroys it). It is only a better answer for the trust pages,
 * so if the scratchpad cannot be reached the facts are built without it.
 */
async function buildFacts(input: {
  auditId: string;
  startUrl: string;
  crawlCompleted: boolean;
  businessOverview: string | null;
  sampledUrls: readonly string[];
}): Promise<SiteFacts> {
  const { buildSiteFacts } = await import("@/server/lib/guidelines/site-facts");
  const pages = await GuidelineEvaluationRepository.getSiteInventory(
    input.auditId,
  );
  let homepageOutlinks: string[] = [];
  try {
    // Link rows are keyed by the normalized URL the crawl requested.
    homepageOutlinks = await getAuditScratchpad(input.auditId).getOutlinks(
      normalizeUrl(input.startUrl) ?? input.startUrl,
    );
  } catch (error) {
    console.warn(
      `Guideline site pass for audit ${input.auditId}: homepage links unavailable`,
      error,
    );
  }
  return buildSiteFacts({
    pages,
    startUrl: input.startUrl,
    crawlCompleted: input.crawlCompleted,
    homepageOutlinks,
    businessOverview: input.businessOverview,
    memberUrlFilter: new Set(input.sampledUrls),
  });
}

async function evaluateWholeSite(
  facts: SiteFacts,
  businessOverview: string | null,
): Promise<PageEvaluation> {
  const [{ evaluateSite }, { resolveJudges }] = await Promise.all([
    import("@/server/lib/guidelines/site-evaluator"),
    import("@/server/lib/guidelines/judge-config"),
  ]);
  const judges = await resolveJudges();
  return evaluateSite({
    facts,
    businessOverview,
    languageJudge: judges.languageJudge,
  });
}

/**
 * Runs a persist step of the site pass. Its retries are the step's; once they
 * are spent the row is given up on, since the audit is worth more than it.
 */
async function persistOrLog(
  step: WorkflowStep,
  name: string,
  auditId: string,
  persist: () => Promise<unknown>,
) {
  try {
    await pgStep(step, name, GUIDELINES_PERSIST_STEP, async () => {
      await persist();
      return null;
    });
  } catch (error) {
    console.error(`Guideline ${name} failed for audit ${auditId}`, error);
  }
}

/**
 * Builds the site facts and judges them. Returns null when there is no site
 * view to give the pages; a failed judgement is still recorded, like a page's.
 */
export async function runSitePass(
  step: WorkflowStep,
  params: {
    auditId: string;
    startUrl: string;
    crawlCompleted: boolean;
    businessOverview: string | null;
    sampledUrls: readonly string[];
  },
): Promise<SitePass | null> {
  const { auditId, businessOverview } = params;

  let facts: SiteFacts;
  try {
    facts = await pgStep(step, "guidelines-site-facts", DB_STEP, () =>
      buildFacts(params),
    );
  } catch (error) {
    // Nothing was judged, so there is nothing to record: the audit simply has
    // no site row, as before the site pass existed.
    console.warn(`Guideline site facts failed for audit ${auditId}`, error);
    return null;
  }

  try {
    // Non-retrying, like a page: a replay must not pay for the judge again.
    // evaluateSite itself never throws; this catches the step's timeout.
    const evaluation = await pgStep(
      step,
      "guidelines-site-eval",
      GUIDELINES_EVAL_STEP,
      () => evaluateWholeSite(facts, businessOverview),
    );
    return { facts, evaluation };
  } catch (error) {
    await persistOrLog(step, "guidelines-site-persist-failed", auditId, () =>
      GuidelineEvaluationRepository.insertFailedEvaluation({
        auditId,
        pageId: null,
        pageUrl: facts.sentinelUrl,
        catalogVersion: CATALOG_VERSION,
        errorMessage: errorMessage(error),
        pageType: "site",
      }),
    );
    return null;
  }
}

/**
 * Settles what the site row reads off the pages (SITE-04, and whether the
 * site touches YMYL topics) and stores it.
 */
export async function persistSitePass(
  step: WorkflowStep,
  input: { auditId: string; site: SitePass; pages: readonly PageSummary[] },
) {
  await persistOrLog(
    step,
    "guidelines-site-persist",
    input.auditId,
    async () => {
      const { finalizeSite } =
        await import("@/server/lib/guidelines/site-evaluator");
      const finalized = finalizeSite(input.site.evaluation, input.pages);
      const ymylTopics = Array.from(
        new Set(input.pages.flatMap((page) => page.ymylTopics)),
      );
      await GuidelineEvaluationRepository.insertEvaluations([
        {
          auditId: input.auditId,
          pageId: null,
          evaluation: {
            ...finalized,
            classification: {
              ...finalized.classification,
              // Informational on the site row: no site rule is gated on it.
              ymyl: ymylTopics.length > 0,
              ymylTopics,
            },
          },
        },
      ]);
    },
  );
}
