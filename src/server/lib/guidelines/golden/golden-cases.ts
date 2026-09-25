/**
 * The guideline golden set: realistic pages paired with the verdict a careful
 * reviewer gives them.
 *
 * Shared by the deterministic suite (`golden.test.ts`, stub judges) and the
 * live eval (`scripts/guidelines-golden-eval.ts`, real judges), so both score a
 * case the same way. How to run and extend it: maintainer-docs/guidelines-evals.md.
 */
import { z } from "zod";
import {
  RULES_BY_ID,
  VERDICTS,
  type Verdict,
} from "@/shared/guidelines/catalog";
import type { PageEvaluation } from "../page-evaluator";
import type { FetchedPage } from "../page-fetch";
import { emptySpamSignals } from "../spam-signals";
import casesJson from "./cases.json";

// `satisfies` makes a new FetchedPage field a type error here, so the cases
// cannot silently drift from what the fetcher produces.
const pageSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  statusCode: z.number(),
  title: z.string(),
  metaDescription: z.string(),
  canonical: z.string().nullable(),
  robotsMeta: z.string().nullable(),
  googlebotMeta: z.string().nullable(),
  robotsHeader: z.string().nullable(),
  h1s: z.array(z.string()),
  wordCount: z.number(),
  bodyText: z.string(),
  structuredData: z.array(z.unknown()),
  imagesTotal: z.number(),
  imagesMissingAlt: z.number(),
  internalLinks: z.number(),
  externalLinks: z.number(),
  isHttps: z.boolean(),
  // Read from raw HTML, which the cases do not carry; a case that needs a
  // signal states it.
  spamSignals: z
    .object({
      historyTraps: z.array(z.string()),
      sneakyRedirects: z.array(z.string()),
      hiddenContent: z.array(z.string()),
      scamFacts: z.array(z.string()),
    })
    .default(emptySpamSignals),
}) satisfies z.ZodType<FetchedPage>;

const caseSchema = z.object({
  id: z.string(),
  kind: z.enum(["legit", "technical", "spam"]),
  description: z.string(),
  notes: z.string().optional(),
  /** The bug this case would have caught. */
  regression_for: z.string().optional(),
  /** Where the code still gets this case wrong, in prose. */
  known_gap: z.string().optional(),
  /** The part of known_gap the suite asserts as still open; see caseProblems. */
  known_gap_checks: z.array(z.enum(["ymyl"])).default([]),
  expected: z.object({
    /** Legit cases: the worst acceptable verdict. */
    verdict_max: z.enum(VERDICTS).optional(),
    /** Spam and technical cases: the verdict must be at least this severe. */
    verdict_min: z.enum(VERDICTS).optional(),
    /** Must fail. Clear-cut rules only; anything arguable goes in notes. */
    must_fail: z.array(z.string()),
    /** Must not fail; warn, unknown and not-applicable are fine. */
    must_not_fail: z.array(z.string()),
    /** Must not pass: for rules no evaluator may close. */
    must_not_pass: z.array(z.string()).default([]),
    ymyl: z.boolean(),
  }),
  page: pageSchema,
});

export type GoldenCase = z.infer<typeof caseSchema>;

export const GOLDEN_CASES: GoldenCase[] = z
  .object({ cases: z.array(caseSchema) })
  .parse(casesJson).cases;

export function verdictRank(verdict: Verdict): number {
  return VERDICTS.indexOf(verdict);
}

/**
 * Everything about one evaluation that contradicts the case, as readable lines.
 * Empty means the case holds.
 *
 * `judged` says whether a judge answered. Without one, a rule the case expects
 * to fail can only stay unanswered (it must never pass), and spam cannot be
 * expected to reach its verdict.
 */
export function caseProblems(
  goldenCase: GoldenCase,
  evaluation: PageEvaluation,
  { judged }: { judged: boolean },
): string[] {
  const { expected } = goldenCase;
  const problems: string[] = [];

  const statusOf = (ruleId: string) =>
    !evaluation.applicableRuleIds.includes(ruleId)
      ? "not applicable"
      : (evaluation.findings.find((finding) => finding.ruleId === ruleId)
          ?.status ?? "pass");

  for (const ruleId of [
    ...expected.must_fail,
    ...expected.must_not_fail,
    ...expected.must_not_pass,
  ]) {
    if (!RULES_BY_ID.has(ruleId)) {
      problems.push(`${ruleId} is not in the catalog`);
    }
  }

  // A known gap is asserted as still open, so the day it is fixed this case
  // fails and gets updated instead of carrying a stale gap forever.
  const ymyl = goldenCase.known_gap_checks.includes("ymyl")
    ? !expected.ymyl
    : expected.ymyl;
  if (evaluation.classification.ymyl !== ymyl) {
    problems.push(
      `classified ymyl=${evaluation.classification.ymyl}, expected ${ymyl}`,
    );
  }

  for (const ruleId of expected.must_fail) {
    const status = statusOf(ruleId);
    const wrong =
      status === "not applicable" ||
      (judged ? status !== "fail" : status === "pass");
    if (wrong) problems.push(`${ruleId} should fail, got ${status}`);
  }
  for (const ruleId of expected.must_not_fail) {
    if (statusOf(ruleId) === "fail") problems.push(`${ruleId} failed`);
  }
  for (const ruleId of expected.must_not_pass) {
    if (statusOf(ruleId) === "pass") problems.push(`${ruleId} passed`);
  }

  const verdict = evaluation.verdict;
  if (
    expected.verdict_max &&
    verdictRank(verdict) > verdictRank(expected.verdict_max)
  ) {
    problems.push(`verdict ${verdict} is worse than ${expected.verdict_max}`);
  }
  if (
    judged &&
    expected.verdict_min &&
    verdictRank(verdict) < verdictRank(expected.verdict_min)
  ) {
    problems.push(`verdict ${verdict} is milder than ${expected.verdict_min}`);
  }
  return problems;
}
