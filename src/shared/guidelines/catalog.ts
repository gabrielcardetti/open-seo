/**
 * The search-engine guidelines rule catalog.
 *
 * `catalog.json` started as the research pack's rule set and is now maintained
 * here: atomic rules distilled from Google's official documentation
 * (people-first content, spam policies, generative-AI guidance, Search
 * Essentials, the Quality Rater Guidelines) and Bing's (the Webmaster
 * Guidelines, "How Bing delivers search results", the robots help articles).
 * It is data, not code: it gets versioned and re-checked against the source
 * documents when an engine updates one, and the parse below is what catches a
 * malformed edit at module load instead of mid-audit.
 *
 * A rule names the engine behind each of its sources, and its `engines` are
 * derived from them: a concept both engines state (cloaking, scraped content)
 * is one rule with two sources, judged once for both. Where the engines
 * disagree, the Bing rule names the Google rule in `conflicts_with`, and its
 * failures can only warn (see `computeVerdict`).
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
import { DEFAULT_ENGINES, ENGINES, type Engine } from "./engines";

/**
 * Who can answer a rule. This is the routing key for the whole evaluation:
 * `binary` and `heuristic` rules are settled in TypeScript against data the
 * crawl already has, `llm` rules need a judge, `gsc` rules need a Search
 * Console connection, `bwt` rules the Bing Webmaster Tools snapshots, and
 * `human`/`hybrid` rules cannot be closed by a model alone.
 */
const RULE_CHECKS = [
  "binary",
  "heuristic",
  "llm",
  "gsc",
  "bwt",
  "hybrid",
  "human",
] as const;

export { DEFAULT_ENGINES, ENGINES, type Engine } from "./engines";

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
  "has_bwt",
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

/** One official document a rule rests on, with the words it says. */
const ruleSourceSchema = z.object({
  engine: z.enum(ENGINES),
  /** Source id, e.g. `SRC-SPAM` or `SRC-BWG`. */
  source: z.string().min(1),
  source_url: z.string(),
  official_quote: z.string(),
});

export type RuleSource = z.infer<typeof ruleSourceSchema>;

const ruleSchema = z
  .object({
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
    sources: z.array(ruleSourceSchema).min(1),
    /**
     * Rules of another engine that say the opposite, and how. A rule that
     * names one is that engine's preference, not a requirement every engine
     * shares, so its failure is reported but never blocks a page.
     */
    conflicts_with: z
      .array(z.object({ rule_id: z.string().min(1), note: z.string().min(1) }))
      .optional(),
  })
  .transform((rule) => ({
    ...rule,
    /** The engines the rule's sources come from, in `ENGINES` order. */
    engines: ENGINES.filter((engine) =>
      rule.sources.some((source) => source.engine === engine),
    ),
  }));

/**
 * The documents a source id points at, for the ones that are re-checked by
 * script (see scripts/check-bing-guideline-quotes.ts). `fetch_url` is where
 * the text can be read when the human-facing page is a JavaScript app, and
 * `checked` the date the quotes were last matched against it: Bing's pages
 * carry no date of their own, so the version is kept per source.
 */
const sourceDocumentSchema = z.object({
  engine: z.enum(ENGINES),
  title: z.string().min(1),
  url: z.string().min(1),
  fetch_url: z.string().min(1),
  checked: z.string().min(1),
});

const catalogSchema = z.object({
  catalog_version: z.string().min(1),
  rule_count: z.number().int().positive(),
  source_documents: z.record(z.string(), sourceDocumentSchema).default({}),
  rules: z.array(ruleSchema).min(1),
});

export type GuidelineRule = z.output<typeof ruleSchema>;

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
export const SOURCE_DOCUMENTS = catalog.source_documents;

/** Whether a rule is one of the given engines' guidelines. */
export function ruleIsForEngines(
  rule: GuidelineRule,
  engines: readonly Engine[],
): boolean {
  return rule.engines.some((engine) => engines.includes(engine));
}

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
  /** The project has a Bing Webmaster Tools connection. */
  hasBwt?: boolean;
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
    case "has_bwt":
      return ctx.hasBwt === true;
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
 *
 * `engines` picks whose guidelines are asked: a rule is in when any of its
 * sources is one of them.
 */
export function rulesForContext(
  ctx: RuleContext,
  scope: "page" | "site",
  engines: readonly Engine[] = DEFAULT_ENGINES,
): GuidelineRule[] {
  return catalog.rules.filter(
    (rule) =>
      (rule.scope === scope || rule.scope === "both") &&
      ruleIsForEngines(rule, engines) &&
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
  /**
   * The level this one answer was confirmed at, when it differs from the
   * call's. A page that belongs to a cluster the site pass failed carries the
   * site's confirmation, so its pattern-rule failure weighs as the site's does.
   */
  level?: "page" | "site";
}

interface VerdictSummary {
  verdict: Verdict;
  criticalFails: number;
  highFails: number;
  mediumFails: number;
  lowFails: number;
  publishAllowed: boolean;
}

/** One answer as the verdict arithmetic reads it. */
interface TalliedOutcome {
  status: RuleStatus;
  /** Null for a rule the catalog no longer carries. */
  severity: GuidelineRule["severity"] | null;
  /** The rule is one engine's preference against another's (`conflicts_with`). */
  conflicting: boolean;
}

function tally(outcomes: Iterable<TalliedOutcome>): VerdictSummary {
  let criticalFails = 0;
  let highFails = 0;
  let mediumFails = 0;
  let lowFails = 0;
  let warnings = 0;

  for (const outcome of outcomes) {
    if (outcome.status === "warn") warnings += 1;
    if (outcome.status !== "fail") continue;
    // Where the engines disagree, failing one engine's preference is worth
    // knowing but never blocks a page the other engine's guidance accepts.
    if (outcome.conflicting) {
      warnings += 1;
      continue;
    }
    switch (outcome.severity) {
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

const isConflicting = (rule: GuidelineRule | undefined) =>
  (rule?.conflicts_with?.length ?? 0) > 0;

/**
 * Rolls per-rule outcomes into one verdict, using the catalog's own
 * `verdict_logic`: any critical failure rejects (see `verdictSeverity` for
 * pattern rules judged from one page, and `RuleOutcome.level` for the ones
 * the site pass confirmed), any high failure sends the page back
 * for revision, and medium/low failures are warnings you can publish
 * with. Only `fail` can block a page. A `warn` — a detector hit, a judge's
 * unquoted or unconfirmed failure — cannot, but it keeps the page from reading
 * as a clean pass; `unknown` is the absence of an answer and counts for
 * nothing. A failure on a rule that conflicts with another engine's counts as
 * a warning.
 */
export function computeVerdict(
  outcomes: readonly RuleOutcome[],
  level: "page" | "site" = "page",
): VerdictSummary {
  return tally(
    outcomes.map((outcome) => {
      const rule = RULES_BY_ID.get(outcome.id);
      return {
        status: outcome.status,
        severity: rule ? verdictSeverity(rule, outcome.level ?? level) : null,
        conflicting: isConflicting(rule),
      };
    }),
  );
}

/** A stored non-passing rule result, as `audit_rule_results` keeps it. */
interface StoredRuleResult {
  ruleId: string;
  status: "fail" | "warn" | "unknown";
  /** Already weighed at the level it was confirmed at (`verdictSeverity`). */
  severity: GuidelineRule["severity"];
}

/**
 * One engine's verdict, recomputed from an evaluation's stored results: the
 * rules of other engines are left out, and the rest weigh as they did when
 * the evaluation was stored. Only non-passing rules are stored, so the rules
 * the engine passed are simply absent, as they would be from the verdict.
 */
export function engineVerdictFromResults(
  results: readonly StoredRuleResult[],
  engine: Engine,
): VerdictSummary & { unknownCount: number } {
  const own = results.flatMap((result) => {
    const rule = RULES_BY_ID.get(result.ruleId);
    return rule && rule.engines.includes(engine) ? [{ result, rule }] : [];
  });
  return {
    ...tally(
      own.map(({ result, rule }) => ({
        status: result.status,
        severity: result.severity,
        conflicting: isConflicting(rule),
      })),
    ),
    unknownCount: own.filter(({ result }) => result.status === "unknown")
      .length,
  };
}

/**
 * The engines an evaluation was judged for, read back from its stored
 * results: an engine counts when a result names a rule only that engine has.
 *
 * It works because every evaluation stores at least one such row per engine:
 * the human-review rules no evaluator can close (PF-W10 and SPAM-03 for
 * Google, BING-30's reviewer fallback and BING-03 for Bing) are recorded as
 * `unknown` on every page and site row. A row with no results at all (one
 * that failed to evaluate) falls back to `fallback`.
 */
export function evaluatedEngines(
  results: readonly Pick<StoredRuleResult, "ruleId">[],
  fallback: readonly Engine[],
): Engine[] {
  if (results.length === 0) return [...fallback];
  const found = new Set<Engine>();
  for (const result of results) {
    const engines = RULES_BY_ID.get(result.ruleId)?.engines;
    if (engines?.length === 1) found.add(engines[0]);
  }
  return ENGINES.filter((engine) => found.has(engine));
}
