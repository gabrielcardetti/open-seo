/**
 * How each catalog rule is put to a judge.
 *
 * A decision model (TypeSafe's Jev and the System One class generally) answers
 * a typed question rather than free text: a binary with a probability, a score
 * on a named scale, or a choice among labels. Most guideline rules are already
 * shaped that way — the catalog gives each one a `pass_if` and a `fail_if`, so
 * the default is a binary and only the genuinely graded rules need an entry
 * here.
 *
 * The catalog itself stays untouched: it is versioned data copied from the
 * research pack, and this mapping is our reading of it.
 */
import { RULES_BY_ID, type GuidelineRule, type RuleStatus } from "./catalog";

/** Checks a judge can answer from the page itself. */
const JUDGEABLE_CHECKS = new Set(["llm", "heuristic", "hybrid"]);

/**
 * Rules a model must never close on its own, whatever its check type says.
 *
 * `hybrid` rules are judgeable — the model contributes half the answer — but
 * these four turn on evidence that does not exist on the page: server-side
 * cloaking, an injected-malware scan, the operator's own disclosure of how the
 * page was made. A model asked anyway will answer confidently from nothing.
 */
const NEVER_AUTO_CLOSE = new Set(["SPAM-01", "SPAM-04", "SPAM-08", "AI-03"]);

type JudgeQuestion =
  | { kind: "binary"; labels: [string, string] }
  | { kind: "score"; levels: string[] }
  | { kind: "choice"; options: string[] };

/**
 * Rules that are graded rather than passed or failed. The scales come from the
 * catalog's own vocabulary — the evaluation schema carries a 1-5 `score`, and
 * QRG-01 is the Quality Rater page-quality ladder.
 */
const GRADED: Record<string, JudgeQuestion> = {
  "PF-Q01": {
    kind: "score",
    levels: [
      "nothing original at all",
      "a little original framing",
      "some original analysis",
      "substantial original analysis",
      "original research or first-hand data",
    ],
  },
  "EAT-04": {
    kind: "score",
    levels: [
      "actively deceptive",
      "untrustworthy",
      "unclear",
      "trustworthy",
      "clearly trustworthy and transparent",
    ],
  },
  "QRG-01": {
    kind: "choice",
    options: ["lowest", "low", "medium", "high", "highest"],
  },
};

/** A score of 3 or better, or a QRG rating of medium or better, is a pass. */
const PASSING_FROM = 3;

export function questionFor(rule: GuidelineRule): JudgeQuestion {
  return GRADED[rule.id] ?? { kind: "binary", labels: ["pass", "fail"] };
}

/**
 * The prompt a judge sees for one rule: the catalog's question plus the exact
 * conditions it wrote for passing and failing. Nothing is paraphrased — the
 * whole point of the catalog is that the criteria are Google's, not ours.
 */
export function instructionsFor(rule: GuidelineRule): string {
  return [
    rule.question,
    `PASS when: ${rule.pass_if}`,
    `FAIL when: ${rule.fail_if}`,
    "This judges a web page against Google Search's official quality" +
      " guidelines. Judge only what the page itself shows.",
  ].join("\n");
}

/**
 * The rules a judge is asked, out of a set already filtered by precondition and
 * scope. Anything needing Search Console, a human sign-off, or evidence the
 * page cannot carry is excluded here rather than asked and then discarded.
 */
export function judgeableRules(
  rules: readonly GuidelineRule[],
): GuidelineRule[] {
  return rules.filter(
    (rule) =>
      JUDGEABLE_CHECKS.has(rule.check) && !NEVER_AUTO_CLOSE.has(rule.id),
  );
}

/** Why a rule was not judged, for the `unknown` result it produces instead. */
export function unjudgeableReason(rule: GuidelineRule): string | null {
  if (NEVER_AUTO_CLOSE.has(rule.id)) {
    return "Needs evidence the page cannot show; a reviewer has to decide.";
  }
  switch (rule.check) {
    case "gsc":
      return "Needs Search Console data for this URL.";
    case "human":
      return "Needs a human reviewer.";
    case "binary":
      return "Settled from crawl data, not by a judge.";
    default:
      return null;
  }
}

/**
 * Turns one judge answer back into a rule status.
 *
 * `confidence` is the margin between the top two labels, so a low value is the
 * model reporting a coin flip rather than a verdict. Below the threshold the
 * status is `unknown`: the rule then goes to a second, slower judge instead of
 * being recorded as a finding nobody can defend. Measured on a 12-page corpus,
 * every verdict at or above 0.3 was stable across repeated runs while the ones
 * that flipped averaged 0.10 — hence the floor.
 */
export const MIN_CONFIDENCE = 0.3;

export function statusFromAnswer(
  rule: GuidelineRule,
  answer: { label?: string; index?: number; confidence?: number | null },
): RuleStatus {
  if ((answer.confidence ?? 0) < MIN_CONFIDENCE) return "unknown";

  const question = questionFor(rule);
  if (question.kind === "binary") {
    if (answer.label === "pass") return "pass";
    if (answer.label === "fail") return "fail";
    return "unknown";
  }

  const options =
    question.kind === "score" ? question.levels : question.options;
  const index =
    answer.index ?? (answer.label ? options.indexOf(answer.label) : -1);
  if (index < 0) return "unknown";
  // A graded rule one notch below passing is a warning, not a failure: the
  // catalog reserves `fail` for what blocks publication.
  if (index + 1 >= PASSING_FROM) return "pass";
  return index + 1 === PASSING_FROM - 1 ? "warn" : "fail";
}

/** Every rule id the catalog carries that this module claims to grade. */
export function gradedRuleIds(): string[] {
  return Object.keys(GRADED).filter((id) => RULES_BY_ID.has(id));
}
