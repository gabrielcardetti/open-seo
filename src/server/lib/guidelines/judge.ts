/**
 * The judging contract.
 *
 * A judge answers guideline rules about one page. There are three kinds and
 * they are genuinely different instruments, not interchangeable backends:
 *
 * - a decision model (Jev on Workers AI) answers every rule at once, in
 *   milliseconds, with a calibrated confidence — but cannot write a sentence;
 * - a language model writes the evidence and reasoning a finding needs to be
 *   actionable, and costs output tokens to do it;
 * - an external agent (the MCP client's own model) does the same work on
 *   someone else's subscription.
 *
 * So the pipeline uses them together: the decision model judges everything
 * cheaply, and the language model is spent only on what the first one flagged
 * or was unsure about.
 */
import type { GuidelineRule, RuleStatus } from "@/shared/guidelines/catalog";
import type { FetchedPage } from "./page-fetch";

export type JudgeName = "jev" | "llm" | "mcp";

export interface JudgedRule {
  ruleId: string;
  status: RuleStatus;
  /** 1-5 for graded rules. */
  score?: number | null;
  /** The judge's certainty, where it reports one. */
  confidence?: number | null;
  /** Short quote from the page. Decision models cannot produce this. */
  evidence?: string | null;
  reason?: string | null;
}

export interface JudgeInput {
  page: FetchedPage;
  rules: readonly GuidelineRule[];
  /** Business context, so "who is this for?" is answerable. */
  businessOverview?: string | null;
}

export interface RuleJudge {
  readonly name: JudgeName;
  /** Model identifier recorded alongside the verdict, for attribution. */
  readonly modelId: string;
  judge(input: JudgeInput): Promise<JudgedRule[]>;
}

/** Characters of main content handed to a judge. */
const MAX_JUDGE_CONTENT_CHARS = 12_000;

/**
 * The page as a judge sees it.
 *
 * Deliberately flat text rather than JSON: these are questions about what a
 * reader encounters, and a reader does not encounter field names. The metadata
 * is included because several rules are about the gap between what a page
 * promises in its title and what it delivers in its body.
 */
export function renderPageState(
  page: FetchedPage,
  businessOverview?: string | null,
): string {
  const lines = [
    `URL: ${page.finalUrl}`,
    `TITLE: ${page.title || "(none)"}`,
    `META DESCRIPTION: ${page.metaDescription || "(none)"}`,
    `H1: ${page.h1s.join(" | ") || "(none)"}`,
    `WORD COUNT: ${page.wordCount}`,
    `IMAGES: ${page.imagesTotal} (${page.imagesMissingAlt} without alt text)`,
    `LINKS: ${page.internalLinks} internal, ${page.externalLinks} external`,
  ];
  if (page.structuredData.length > 0) {
    lines.push(
      `STRUCTURED DATA: ${JSON.stringify(page.structuredData).slice(0, 1500)}`,
    );
  }
  if (businessOverview?.trim()) {
    lines.push(`SITE CONTEXT: ${businessOverview.trim().slice(0, 800)}`);
  }
  lines.push("MAIN CONTENT:", page.bodyText.slice(0, MAX_JUDGE_CONTENT_CHARS));
  return lines.join("\n");
}

/**
 * Which rules still need a language model after the decision model ran.
 *
 * Two groups: anything it flagged, because a finding without evidence is not
 * actionable, and anything it was unsure about, because an `unknown` is an
 * unanswered question rather than a verdict. Confident passes are left alone —
 * that is the whole saving.
 */
export function rulesNeedingSecondPass(
  judged: readonly JudgedRule[],
): Set<string> {
  const needed = new Set<string>();
  for (const result of judged) {
    if (
      result.status === "fail" ||
      result.status === "warn" ||
      result.status === "unknown"
    ) {
      needed.add(result.ruleId);
    }
  }
  return needed;
}

/**
 * Merge a second-pass answer over a first-pass one.
 *
 * The language model's status wins, because it saw the page as prose and can
 * tell a real failure from a pattern match. The decision model's confidence is
 * kept: it is the only calibrated number in the pair, and it is what makes a
 * later "how sure were we?" question answerable.
 */
export function mergeJudgements(
  first: readonly JudgedRule[],
  second: readonly JudgedRule[],
): JudgedRule[] {
  const bySecond = new Map(second.map((result) => [result.ruleId, result]));
  const merged = first.map((result) => {
    const refined = bySecond.get(result.ruleId);
    if (!refined) return result;
    return {
      ...result,
      status: refined.status,
      evidence: refined.evidence ?? result.evidence ?? null,
      reason: refined.reason ?? result.reason ?? null,
      score: refined.score ?? result.score ?? null,
    };
  });
  // A rule only the second pass answered (the first judge skipped or dropped
  // it) still belongs in the results.
  const seen = new Set(merged.map((result) => result.ruleId));
  for (const result of second) {
    if (!seen.has(result.ruleId)) merged.push(result);
  }
  return merged;
}
