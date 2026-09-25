/**
 * The Google Search guidelines rule catalog.
 *
 * `catalog.json` started as the research pack's rule set and is now maintained
 * here: atomic rules distilled from Google's official documentation
 * (people-first content, spam policies, generative-AI guidance, Search
 * Essentials, the Quality Rater Guidelines). It is data, not code: it gets
 * versioned and re-checked against the source documents when Google updates
 * one, and the parse below is what catches a malformed edit at module load
 * instead of mid-audit.
 *
 * Severity follows how Google frames each source. `critical` is for what Google
 * calls a violation or a blocker (spam policies, pages it cannot index, YMYL
 * harm, active deception); the people-first self-assessment questions are
 * advice and top out at `high`.
 *
 * Every rule carries the source URL it came from, and every critical or high
 * rule an official quote, so a finding can always be traced back to the
 * guideline that produced it.
 */
import { z } from "zod";
import catalogJson from "./catalog.json";

/**
 * Who can answer a rule. This is the routing key for the whole evaluation:
 * `binary` and `heuristic` rules are settled in TypeScript against data the
 * crawl already has, `llm` rules need a judge, `gsc` rules need a Search
 * Console connection, and `human`/`hybrid` rules cannot be closed by a model
 * alone.
 */
const RULE_CHECKS = [
  "binary",
  "heuristic",
  "llm",
  "gsc",
  "hybrid",
  "human",
] as const;

/** Page-level, site-level, or judged at both levels. */
const RULE_SCOPES = ["page", "site", "both"] as const;

const RULE_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * Preconditions that decide whether a rule is asked at all. Asking a rule
 * whose precondition does not hold is not free: it spends a judge call and
 * invites a made-up verdict on a page the rule was never written for.
 */
const RULE_PRECONDITIONS = [
  "always",
  "ymyl",
  "is_review",
  "has_schema",
  "has_gsc",
  "has_cwv",
  "ai_suspected",
  "wants_ai_features",
  "ecommerce_ai_images",
  "ecommerce_ai_copy",
] as const;

/**
 * The outcome of one rule against one page. `unknown` means the data needed to
 * decide was missing — it is never a guess, and it never becomes a finding.
 */
export const RULE_STATUSES = [
  "pass",
  "fail",
  "warn",
  "n/a",
  "unknown",
] as const;

export const VERDICTS = [
  "pass",
  "pass_with_warnings",
  "revise",
  "reject",
] as const;

export type RuleStatus = (typeof RULE_STATUSES)[number];
export type Verdict = (typeof VERDICTS)[number];

const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  scope: z.enum(RULE_SCOPES),
  severity: z.enum(RULE_SEVERITIES),
  check: z.enum(RULE_CHECKS),
  applies_if: z.enum(RULE_PRECONDITIONS),
  question: z.string().min(1),
  pass_if: z.string(),
  fail_if: z.string(),
  remediation: z.string(),
  source: z.string(),
  source_url: z.string(),
  official_quote: z.string(),
});

const catalogSchema = z.object({
  catalog_version: z.string().min(1),
  rule_count: z.number().int().positive(),
  rules: z.array(ruleSchema).min(1),
});

export type GuidelineRule = z.infer<typeof ruleSchema>;

/**
 * Parsed at module load. A bad catalog is a deploy-time problem, not something
 * to discover on the audit's hot path — and `rule_count` is checked against the
 * real array length so a truncated file cannot pass quietly.
 */
function parseCatalog(): z.infer<typeof catalogSchema> {
  const parsed = catalogSchema.parse(catalogJson);
  if (parsed.rules.length !== parsed.rule_count) {
    throw new Error(
      `Guideline catalog declares ${parsed.rule_count} rules but carries ${parsed.rules.length}`,
    );
  }
  const ids = new Set(parsed.rules.map((rule) => rule.id));
  if (ids.size !== parsed.rules.length) {
    throw new Error("Guideline catalog has duplicate rule ids");
  }
  return parsed;
}

const catalog = parseCatalog();

export const CATALOG_VERSION = catalog.catalog_version;
export const GUIDELINE_RULES: readonly GuidelineRule[] = catalog.rules;
export const RULES_BY_ID: ReadonlyMap<string, GuidelineRule> = new Map(
  catalog.rules.map((rule) => [rule.id, rule]),
);

/**
 * What we know about a page before any rule is judged. Every field is a
 * precondition input; `undefined` means "not determined", which keeps the
 * dependent rules out of the asked set rather than guessing them in.
 */
export interface RuleContext {
  ymyl?: boolean;
  isReview?: boolean;
  hasSchema?: boolean;
  hasGsc?: boolean;
  hasCoreWebVitals?: boolean;
  aiSuspected?: boolean;
  wantsAiFeatures?: boolean;
  isEcommerce?: boolean;
}

function preconditionHolds(rule: GuidelineRule, ctx: RuleContext): boolean {
  switch (rule.applies_if) {
    case "always":
      return true;
    case "ymyl":
      return ctx.ymyl === true;
    case "is_review":
      return ctx.isReview === true;
    case "has_schema":
      return ctx.hasSchema === true;
    case "has_gsc":
      return ctx.hasGsc === true;
    case "has_cwv":
      return ctx.hasCoreWebVitals === true;
    case "ai_suspected":
      return ctx.aiSuspected === true;
    case "wants_ai_features":
      return ctx.wantsAiFeatures === true;
    case "ecommerce_ai_images":
    case "ecommerce_ai_copy":
      return ctx.isEcommerce === true;
  }
}

/**
 * The rules that apply to one target, filtered by precondition and by scope.
 *
 * Scope matters as much as the precondition: a site-scope rule ("is this domain
 * a content farm?") cannot be answered from a single page's text, and asking it
 * there produces a confident, useless `pass` — one doorway page in isolation
 * looks ordinary. Site rules are judged once per domain against the URL
 * inventory instead.
 */
export function rulesForContext(
  ctx: RuleContext,
  scope: "page" | "site",
): GuidelineRule[] {
  return catalog.rules.filter(
    (rule) =>
      (rule.scope === scope || rule.scope === "both") &&
      preconditionHolds(rule, ctx),
  );
}

/**
 * The severity a rule's failure carries at a given level of evaluation.
 *
 * A `both` rule asks about a pattern — doorway sets, scaled content, one URL per
 * query variant — and a single page shows at most a hint of it. Answered from
 * one page, a critical `both` rule can send the page back for revision but not
 * reject it; rejecting on a pattern takes the site-level view that can see it.
 */
export function verdictSeverity(
  rule: GuidelineRule,
  level: "page" | "site",
): GuidelineRule["severity"] {
  if (
    rule.severity === "critical" &&
    rule.scope === "both" &&
    level === "page"
  ) {
    return "high";
  }
  return rule.severity;
}

interface RuleOutcome {
  id: string;
  status: RuleStatus;
}

interface VerdictSummary {
  verdict: Verdict;
  criticalFails: number;
  highFails: number;
  mediumFails: number;
  lowFails: number;
  publishAllowed: boolean;
}

/**
 * Rolls per-rule outcomes into one verdict, using the catalog's own
 * `verdict_logic`: any critical failure rejects (see `verdictSeverity` for
 * pattern rules judged from one page), any high failure sends the page back
 * for revision, and medium/low failures are warnings you can publish
 * with. Only `fail` can block a page. A `warn` — a detector hit, a judge's
 * unquoted or unconfirmed failure — cannot, but it keeps the page from reading
 * as a clean pass; `unknown` is the absence of an answer and counts for
 * nothing.
 */
export function computeVerdict(
  outcomes: readonly RuleOutcome[],
  level: "page" | "site" = "page",
): VerdictSummary {
  let criticalFails = 0;
  let highFails = 0;
  let mediumFails = 0;
  let lowFails = 0;
  let warnings = 0;

  for (const outcome of outcomes) {
    if (outcome.status === "warn") warnings += 1;
    if (outcome.status !== "fail") continue;
    const rule = RULES_BY_ID.get(outcome.id);
    switch (rule && verdictSeverity(rule, level)) {
      case "critical":
        criticalFails += 1;
        break;
      case "high":
        highFails += 1;
        break;
      case "medium":
        mediumFails += 1;
        break;
      case "low":
        lowFails += 1;
        break;
      default:
        // A result for a rule the catalog no longer carries: ignore it rather
        // than letting a stale id swing a verdict.
        break;
    }
  }

  const verdict: Verdict =
    criticalFails > 0
      ? "reject"
      : highFails > 0
        ? "revise"
        : mediumFails > 0 || lowFails > 0 || warnings > 0
          ? "pass_with_warnings"
          : "pass";

  return {
    verdict,
    criticalFails,
    highFails,
    mediumFails,
    lowFails,
    publishAllowed: verdict === "pass" || verdict === "pass_with_warnings",
  };
}
