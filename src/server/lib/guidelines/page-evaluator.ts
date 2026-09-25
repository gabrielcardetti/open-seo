/**
 * Evaluates one page against the catalog, end to end.
 *
 * Order matters, and it is an order of increasing cost:
 *
 *   classify -> pick applicable rules -> deterministic -> decision model -> language model
 *
 * Each stage removes work from the next. Classification decides which rules are
 * even asked; the deterministic evaluators settle what the page data proves;
 * the decision model judges the rest for a fraction of a cent; and the language
 * model is spent only on what came back flagged or uncertain.
 */
import { sort } from "remeda";
import {
  CATALOG_VERSION,
  RULES_BY_ID,
  computeVerdict,
  rulesForContext,
  verdictSeverity,
  type GuidelineRule,
  type RuleContext,
  type Verdict,
} from "@/shared/guidelines/catalog";
import {
  judgeableRules,
  unjudgeableReason,
} from "@/shared/guidelines/judge-map";
import {
  mergeJudgements,
  rulesNeedingSecondPass,
  withoutUngroundedFails,
  type JudgedRule,
  type RuleJudge,
} from "./judge";
import type { FetchedPage } from "./page-fetch";
import { classifyPage, type PageClassification } from "./page-classifier";
import {
  evaluateDeterministic,
  type EvaluationContext,
} from "./rule-evaluators";

export interface PageEvaluation {
  url: string;
  catalogVersion: string;
  classification: PageClassification;
  verdict: Verdict;
  criticalFails: number;
  highFails: number;
  mediumFails: number;
  lowFails: number;
  unknownCount: number;
  judge: string;
  /** Non-passing rules only; passes are derivable from the applicable set. */
  findings: EvaluatedRule[];
  /** Every rule that was applicable, so a pass is distinguishable from unasked. */
  applicableRuleIds: string[];
}

export interface EvaluatedRule {
  ruleId: string;
  /** Findings are non-passing by construction; a pass produces no row. */
  status: "fail" | "warn" | "unknown";
  severity: GuidelineRule["severity"];
  score: number | null;
  confidence: number | null;
  evidence: string | null;
  reason: string | null;
  remediation: string;
}

function toRuleContext(classification: PageClassification): RuleContext {
  return {
    ymyl: classification.ymyl,
    isReview: classification.isReview,
    hasSchema: classification.hasSchema,
    aiSuspected: classification.aiSuspected,
    // Search Console and Core Web Vitals are separate phases; leaving these
    // undefined keeps their rules out of the asked set instead of guessing.
    hasGsc: undefined,
    hasCoreWebVitals: undefined,
  };
}

/** Below this many words of served text, content rules are not put to a judge. */
const MIN_JUDGEABLE_WORDS = 20;

interface EvaluationPlan {
  classification: PageClassification;
  applicable: GuidelineRule[];
  /** Rules answered without a judge: from page data, or `unknown` with a reason. */
  settled: Map<string, JudgedRule>;
  /** Rules left for a judge. */
  askable: GuidelineRule[];
}

/**
 * Everything decided before a judge is asked: which rules apply, what the page
 * data settles outright, and what no judge may answer.
 *
 * Both judging paths start here — the audit workflow's own judges and an MCP
 * caller judging on its own model — so a noindex or a fake rating fails the
 * same way whichever of them answers the rest.
 */
export function planEvaluation(
  page: FetchedPage,
  context?: Omit<EvaluationContext, "page">,
): EvaluationPlan {
  const classification = classifyPage(page);
  const applicable = rulesForContext(toRuleContext(classification), "page");

  const evaluationContext: EvaluationContext = { page, ...context };
  const settled = new Map<string, JudgedRule>();

  // 1. What the page data proves outright.
  for (const rule of applicable) {
    const result = evaluateDeterministic(rule.id, evaluationContext);
    if (!result) continue;
    settled.set(rule.id, {
      ruleId: rule.id,
      status: result.status,
      confidence: null,
      evidence: result.evidence ?? null,
      reason: result.reason ?? null,
    });
  }

  // 2. What a judge could answer but no judge will be asked. With almost no
  // text in the served HTML — typically an app rendered in the browser — every
  // judged rule is a question about content the judge cannot see, and a judge
  // asked anyway can reject an empty shell for having "no value".
  const remaining = applicable.filter((rule) => !settled.has(rule.id));
  const tooLittleText = page.wordCount < MIN_JUDGEABLE_WORDS;
  const askable = tooLittleText ? [] : judgeableRules(remaining);
  const askableIds = new Set(askable.map((rule) => rule.id));
  for (const rule of remaining) {
    if (askableIds.has(rule.id)) continue;
    settled.set(rule.id, {
      ruleId: rule.id,
      status: "unknown",
      confidence: null,
      evidence: null,
      reason:
        tooLittleText && judgeableRules([rule]).length > 0
          ? "Too little text in the served HTML to judge; needs the rendered page."
          : (unjudgeableReason(rule) ?? "No evaluator for this rule."),
    });
  }

  return { classification, applicable, settled, askable };
}

/** One non-passing verdict as an external judge submits it. */
export interface SubmittedFinding {
  ruleId: string;
  status: "fail" | "warn" | "unknown";
  evidence?: string;
  reason?: string;
}

/**
 * Turns an external judge's findings into rule outcomes for one page.
 *
 * The caller answers only the rules the plan left for a judge; a finding on
 * any other rule is returned in `notAsked` and ignored, so a caller cannot
 * overrule what the page data settled. Silence is the pass signal, as the
 * batch told the caller, and a failure whose quote is not on the page is kept
 * as a warning, exactly as on the audit's own judging path.
 */
export function outcomesFromSubmission(
  plan: EvaluationPlan,
  page: FetchedPage,
  findings: readonly SubmittedFinding[],
): { outcomes: JudgedRule[]; notAsked: string[] } {
  const askableIds = new Set(plan.askable.map((rule) => rule.id));
  const outcomes = new Map(plan.settled);
  const notAsked: string[] = [];
  for (const finding of findings) {
    if (!askableIds.has(finding.ruleId)) {
      notAsked.push(finding.ruleId);
      continue;
    }
    if (outcomes.has(finding.ruleId)) continue;
    outcomes.set(
      finding.ruleId,
      withoutUngroundedFails(
        {
          ruleId: finding.ruleId,
          status: finding.status,
          evidence: finding.evidence?.slice(0, 1000) ?? null,
          reason: finding.reason?.slice(0, 1000) ?? null,
        },
        page,
      ),
    );
  }
  for (const rule of plan.askable) {
    if (!outcomes.has(rule.id)) {
      outcomes.set(rule.id, { ruleId: rule.id, status: "pass" });
    }
  }
  return { outcomes: Array.from(outcomes.values()), notAsked };
}

interface EvaluatePageOptions {
  page: FetchedPage;
  context?: Omit<EvaluationContext, "page">;
  businessOverview?: string | null;
  /** Cheap, calibrated, no prose. Skipped when unavailable. */
  decisionJudge?: RuleJudge | null;
  /** Writes evidence and reasoning. Skipped when unavailable. */
  languageJudge?: RuleJudge | null;
}

export async function evaluatePage({
  page,
  context,
  businessOverview,
  decisionJudge,
  languageJudge,
}: EvaluatePageOptions): Promise<PageEvaluation> {
  const { classification, applicable, settled, askable } = planEvaluation(
    page,
    context,
  );
  const askableIds = new Set(askable.map((rule) => rule.id));

  // 3. The decision model, then the language model over what it flagged.
  let judged: JudgedRule[] = [];
  const judgeNames: string[] = [];

  if (askable.length > 0 && decisionJudge) {
    // The decision model is an optimisation, not a dependency. If it is down
    // or misconfigured, the page carries on exactly as if it were absent: the
    // language model judges every rule, or, with none configured, the rules
    // are recorded as unanswered. Failing the page would throw away the
    // deterministic results that were already correct.
    try {
      judged = await decisionJudge.judge({
        page,
        rules: askable,
        businessOverview,
      });
      judgeNames.push(decisionJudge.modelId);
    } catch (error) {
      console.warn(
        `Guideline decision model failed for ${page.finalUrl}; continuing without it`,
        error,
      );
    }
  }

  if (askable.length > 0 && languageJudge) {
    const needed =
      judged.length > 0
        ? askable.filter((rule) => rulesNeedingSecondPass(judged).has(rule.id))
        : askable;
    if (needed.length > 0) {
      if (judged.length > 0) {
        // A second pass that fails must not cost the first pass's answers.
        // The decision model already produced verdicts; losing them because
        // the evidence-writing model was rate limited or out of credit would
        // make the whole page depend on its most fragile judge. The findings
        // keep their verdicts and simply arrive without a quote.
        try {
          const second = await languageJudge.judge({
            page,
            rules: needed,
            businessOverview,
          });
          judged = mergeJudgements(judged, second);
          judgeNames.push(languageJudge.modelId);
        } catch (error) {
          console.warn(
            `Guideline second pass failed for ${page.finalUrl}; keeping first-pass verdicts`,
            error,
          );
        }
      } else {
        // With no first pass there is nothing to fall back to, so the failure
        // surfaces and the page is recorded as not evaluated.
        judged = await languageJudge.judge({
          page,
          rules: needed,
          businessOverview,
        });
        judgeNames.push(languageJudge.modelId);
      }
    }
  }

  // A decision model is a filter, not a verdict. It is exact on clear-cut pages
  // and unreliable on the nuanced middle where real sites live — its first
  // production run rejected a page that reads as exemplary, over rules about
  // first-hand experience written for product reviews. Without a second judge
  // to read the page and quote it, its failures are recorded as warnings to
  // confirm, so they surface without being able to reject a page on their own.
  const decisionOnly =
    decisionJudge !== undefined &&
    decisionJudge !== null &&
    judgeNames.length === 1 &&
    judgeNames[0] === decisionJudge.modelId;
  for (const result of judged) {
    if (!askableIds.has(result.ruleId)) continue;
    settled.set(
      result.ruleId,
      decisionOnly && result.status === "fail"
        ? {
            ...result,
            status: "warn",
            reason:
              result.reason ??
              "Flagged by the decision model; no second judge has confirmed it.",
          }
        : withoutUngroundedFails(result, page),
    );
  }

  // A rule nobody answered is unknown, not a pass. Recording it keeps the
  // verdict honest about how much of it rests on missing answers.
  for (const rule of askable) {
    if (!settled.has(rule.id)) {
      settled.set(rule.id, {
        ruleId: rule.id,
        status: "unknown",
        confidence: null,
        evidence: null,
        reason: "No judge answered this rule.",
      });
    }
  }

  return summarizeEvaluation({
    page,
    classification,
    applicable,
    outcomes: Array.from(settled.values()),
    judge: judgeNames.join("+") || "deterministic",
  });
}

/**
 * Rolls every rule's outcome into the stored evaluation: the verdict, the
 * counts, and the non-passing rules as findings in severity order.
 */
export function summarizeEvaluation({
  page,
  classification,
  applicable,
  outcomes,
  judge,
}: {
  page: FetchedPage;
  classification: PageClassification;
  applicable: readonly GuidelineRule[];
  outcomes: readonly JudgedRule[];
  judge: string;
}): PageEvaluation {
  const summary = computeVerdict(
    outcomes.map((result) => ({ id: result.ruleId, status: result.status })),
  );

  const findings: EvaluatedRule[] = outcomes
    .filter(
      (
        result,
      ): result is JudgedRule & { status: "fail" | "warn" | "unknown" } =>
        result.status !== "pass" && result.status !== "n/a",
    )
    .map((result) => {
      const rule = RULES_BY_ID.get(result.ruleId)!;
      return {
        ruleId: result.ruleId,
        status: result.status,
        severity: verdictSeverity(rule, "page"),
        score: result.score ?? null,
        confidence: result.confidence ?? null,
        evidence: result.evidence ?? null,
        reason: result.reason ?? null,
        // Copied from the catalog, never written by a model.
        remediation: rule.remediation,
      };
    });

  // Severity order, so the thing to fix first is first. remeda's sort returns
  // a new array (toSorted is past this tsconfig's lib target).
  const orderedFindings = sort(
    findings,
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );

  return {
    url: page.finalUrl,
    catalogVersion: CATALOG_VERSION,
    classification,
    verdict: summary.verdict,
    criticalFails: summary.criticalFails,
    highFails: summary.highFails,
    mediumFails: summary.mediumFails,
    lowFails: summary.lowFails,
    unknownCount: outcomes.filter((result) => result.status === "unknown")
      .length,
    judge,
    findings: orderedFindings,
    applicableRuleIds: applicable.map((rule) => rule.id),
  };
}

function severityRank(severity: GuidelineRule["severity"]): number {
  return severity === "critical"
    ? 0
    : severity === "high"
      ? 1
      : severity === "medium"
        ? 2
        : 3;
}
