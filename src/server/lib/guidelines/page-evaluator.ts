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
  type JudgedRule,
  type RuleJudge,
} from "./judge";
import type { FetchedPage } from "./page-fetch";
import {
  evaluateDeterministic,
  type EvaluationContext,
} from "./rule-evaluators";

export type PageType =
  | "article"
  | "hub"
  | "product"
  | "review"
  | "category"
  | "landing"
  | "ugc"
  | "other";

const YMYL_TOPICS = [
  "health_safety",
  "financial",
  "government_civics_society",
  "other_wellbeing",
] as const;

export type YmylTopic = (typeof YMYL_TOPICS)[number];

export interface PageClassification {
  pageType: PageType;
  ymyl: boolean;
  ymylTopics: YmylTopic[];
  isReview: boolean;
  hasSchema: boolean;
  aiSuspected: boolean;
}

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

/**
 * Topic markers for the YMYL call, matched against the page's own words.
 *
 * Deliberately broad. Misclassifying a YMYL page as ordinary drops the strict
 * rules that exist precisely for pages that can hurt someone; the opposite
 * mistake only asks a few extra questions. When a judge is available it decides
 * instead, and this is the floor.
 */
const YMYL_MARKERS: Array<{ topic: YmylTopic; pattern: RegExp }> = [
  {
    topic: "health_safety",
    pattern:
      /\b(s[ií]ntoma|diagn[oó]stic|tratamiento|medicament|dosis|enfermedad|salud|m[eé]dic|terapia|symptom|diagnos|treatment|medication|dosage|disease|health|medical)\w*/i,
  },
  {
    topic: "financial",
    pattern:
      /\b(invers|hipotec|pr[eé]stamo|impuesto|jubilaci[oó]n|seguro|cr[eé]dito|invest|mortgage|loan|tax|retirement|insurance|credit)\w*/i,
  },
  {
    topic: "government_civics_society",
    pattern:
      /\b(oposici[oó]n|convocatoria|bolet[ií]n oficial|legal|derecho|abogad|elecci[oó]n|votaci[oó]n|inmigraci[oó]n|visa|law|legal|rights|election|immigration|government)\w*/i,
  },
];

/** Phrasing that suggests a page exists for a search engine rather than a reader. */
const AI_SCALE_MARKERS =
  /\b(en conclusi[oó]n|esperamos que este art[ií]culo|en este art[ií]culo te (mostramos|explicamos)|gu[ií]a definitiva|in conclusion|we hope this article|ultimate guide|in this article we will)\b/i;

/**
 * Classify a page from its own content.
 *
 * Used as the input to rule selection, so it runs before anything expensive.
 * It stays heuristic on purpose: the classification decides which questions get
 * asked, and it is better to ask a few unnecessary questions than to skip the
 * strict ones.
 */
export function classifyPage(page: FetchedPage): PageClassification {
  const haystack = `${page.title} ${page.h1s.join(" ")} ${page.bodyText.slice(0, 6000)}`;

  const ymylTopics = YMYL_MARKERS.filter(({ pattern }) =>
    pattern.test(haystack),
  ).map(({ topic }) => topic);

  const isReview =
    /\b(review|rese[ñn]a|an[aá]lisis de|comparativa|mejores \d+|best \d+|vs\.?)\b/i.test(
      `${page.title} ${page.h1s.join(" ")}`,
    );

  const path = (() => {
    try {
      return new URL(page.finalUrl).pathname;
    } catch {
      return "/";
    }
  })();

  const pageType: PageType = isReview
    ? "review"
    : path === "/" || path === ""
      ? "landing"
      : /\/(blog|guias|guides|articulo|article|post)\//i.test(path)
        ? "article"
        : page.internalLinks > 30 && page.wordCount < 400
          ? "category"
          : "article";

  return {
    pageType,
    ymyl: ymylTopics.length > 0,
    ymylTopics,
    isReview,
    hasSchema: page.structuredData.length > 0,
    aiSuspected: AI_SCALE_MARKERS.test(haystack),
  };
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

  // 2. What a judge could answer but no judge will be asked.
  const remaining = applicable.filter((rule) => !settled.has(rule.id));
  const askable = judgeableRules(remaining);
  const askableIds = new Set(askable.map((rule) => rule.id));
  for (const rule of remaining) {
    if (askableIds.has(rule.id)) continue;
    settled.set(rule.id, {
      ruleId: rule.id,
      status: "unknown",
      confidence: null,
      evidence: null,
      reason: unjudgeableReason(rule) ?? "No evaluator for this rule.",
    });
  }

  // 3. The decision model, then the language model over what it flagged.
  let judged: JudgedRule[] = [];
  const judgeNames: string[] = [];

  if (askable.length > 0 && decisionJudge) {
    judged = await decisionJudge.judge({
      page,
      rules: askable,
      businessOverview,
    });
    judgeNames.push(decisionJudge.modelId);
  }

  if (askable.length > 0 && languageJudge) {
    const needed =
      judged.length > 0
        ? askable.filter((rule) => rulesNeedingSecondPass(judged).has(rule.id))
        : askable;
    if (needed.length > 0) {
      const second = await languageJudge.judge({
        page,
        rules: needed,
        businessOverview,
      });
      judged = judged.length > 0 ? mergeJudgements(judged, second) : second;
      judgeNames.push(languageJudge.modelId);
    }
  }

  for (const result of judged) {
    if (askableIds.has(result.ruleId)) settled.set(result.ruleId, result);
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

  const outcomes = Array.from(settled.values());
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
        severity: rule.severity,
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
    judge: judgeNames.join("+") || "deterministic",
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
