import process from "node:process";
import { chunk, sort } from "remeda";
import { CATALOG_VERSION } from "@/shared/guidelines/catalog";
import {
  GOLDEN_CASES,
  caseProblems,
  verdictRank,
  type GoldenCase,
} from "@/server/lib/guidelines/golden/golden-cases";
import { isGroundedQuote } from "@/server/lib/guidelines/judge";
import { buildJudges } from "@/server/lib/guidelines/judge-config";
import {
  evaluatePage,
  planEvaluation,
  type PageEvaluation,
} from "@/server/lib/guidelines/page-evaluator";
import { loadLocalEnv, parseArgs } from "./cli-utils";

/**
 * Runs the guideline golden cases through the real judges and scores them.
 *
 * The vitest suite proves the pipeline with a perfect stub judge; this measures
 * the judges themselves. It calls whatever judges the environment configures
 * (the same variables the Worker reads), so it can cost money: use --dry-run
 * to check the harness with the deterministic rules only.
 *
 * Usage:
 *   pnpm tsx scripts/guidelines-golden-eval.ts [--runs 3] [--case legit-] [--json] [--dry-run]
 *
 * Exits 1 when a gate fails or an evaluation errors. See
 * maintainer-docs/guidelines-evals.md.
 */

/** A legit page must never be rejected. */
const MAX_FALSE_REJECT_RATE = 0;
/** Share of spam and technical cases that must reach their expected verdict. */
const MIN_SPAM_RECALL = 0.9;
/** Same as the audit workflow, so rate limits behave the same. */
const CONCURRENCY = 4;

interface RunResult {
  caseId: string;
  run: number;
  evaluation: PageEvaluation | null;
  error: string | null;
  problems: string[];
}

interface UngroundedQuote {
  caseId: string;
  run: number;
  ruleId: string;
  evidence: string;
}

loadLocalEnv();
const args = parseArgs(process.argv.slice(2));
await main();

async function main() {
  const runs = Number(args.runs ?? "1");
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  const dryRun = args["dry-run"] === "true";
  const cases = GOLDEN_CASES.filter((goldenCase) =>
    goldenCase.id.includes(args.case ?? ""),
  );

  const { decisionJudge, languageJudge } = dryRun
    ? { decisionJudge: null, languageJudge: null }
    : buildJudges((name) => process.env[name] || undefined);
  const judged = decisionJudge !== null || languageJudge !== null;
  const judges =
    [decisionJudge?.modelId, languageJudge?.modelId]
      .filter(Boolean)
      .join(" + ") || "none (deterministic rules only)";

  const jobs = cases.flatMap((goldenCase) =>
    Array.from({ length: runs }, (_, run) => ({ goldenCase, run: run + 1 })),
  );
  const results: RunResult[] = [];
  for (const wave of chunk(jobs, CONCURRENCY)) {
    results.push(
      ...(await Promise.all(
        wave.map(async ({ goldenCase, run }): Promise<RunResult> => {
          try {
            const evaluation = await evaluatePage({
              page: goldenCase.page,
              decisionJudge,
              languageJudge,
            });
            return {
              caseId: goldenCase.id,
              run,
              evaluation,
              error: null,
              problems: caseProblems(goldenCase, evaluation, { judged }),
            };
          } catch (error) {
            return {
              caseId: goldenCase.id,
              run,
              evaluation: null,
              error: error instanceof Error ? error.message : String(error),
              problems: [],
            };
          }
        }),
      )),
    );
  }

  const report = score({ cases, results, judged, runs });
  const failedGates = [
    report.falseRejectRate !== null &&
    report.falseRejectRate > MAX_FALSE_REJECT_RATE
      ? `false-reject rate ${percent(report.falseRejectRate)} > ${percent(MAX_FALSE_REJECT_RATE)}`
      : null,
    report.spamRecall !== null && report.spamRecall < MIN_SPAM_RECALL
      ? `spam recall ${percent(report.spamRecall)} < ${percent(MIN_SPAM_RECALL)}`
      : null,
    report.errors > 0 ? `${report.errors} evaluation(s) errored` : null,
  ].filter((gate) => gate !== null);

  if (args.json === "true") {
    console.log(
      JSON.stringify(
        {
          catalogVersion: CATALOG_VERSION,
          judges,
          runs,
          ...report,
          failedGates,
          results: results.map(({ evaluation, ...rest }) => ({
            ...rest,
            verdict: evaluation?.verdict ?? null,
            judge: evaluation?.judge ?? null,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    printReport({ cases, results, judges, runs, report, failedGates });
  }
  process.exitCode = failedGates.length > 0 ? 1 : 0;
}

function score({
  cases,
  results,
  judged,
  runs,
}: {
  cases: GoldenCase[];
  results: RunResult[];
  judged: boolean;
  runs: number;
}) {
  const caseById = new Map(
    cases.map((goldenCase) => [goldenCase.id, goldenCase]),
  );
  const completed = results.flatMap((result) =>
    result.evaluation
      ? [
          {
            ...result,
            evaluation: result.evaluation,
            goldenCase: caseById.get(result.caseId)!,
          },
        ]
      : [],
  );

  const legit = completed.filter(
    ({ goldenCase }) => goldenCase.kind === "legit",
  );
  const spam = completed.filter(
    ({ goldenCase }) => goldenCase.kind !== "legit",
  );
  const falseRejects = legit.filter(
    ({ evaluation }) => evaluation.verdict === "reject",
  );
  const caught = spam.filter(
    ({ goldenCase, evaluation }) =>
      verdictRank(evaluation.verdict) >=
      verdictRank(goldenCase.expected.verdict_min ?? "pass"),
  );

  // Per rule: fails where the case says it must not fail, and misses where it
  // says it must. The rule at the top of this list names the prompt to fix.
  const perRule = new Map<string, { falseFails: number; misses: number }>();
  const bump = (ruleId: string, key: "falseFails" | "misses") => {
    const counts = perRule.get(ruleId) ?? { falseFails: 0, misses: 0 };
    counts[key] += 1;
    perRule.set(ruleId, counts);
  };
  for (const { goldenCase, evaluation } of completed) {
    const failed = new Set(
      evaluation.findings
        .filter((finding) => finding.status === "fail")
        .map((finding) => finding.ruleId),
    );
    for (const ruleId of goldenCase.expected.must_not_fail) {
      if (failed.has(ruleId)) bump(ruleId, "falseFails");
    }
    if (!judged) continue;
    for (const ruleId of goldenCase.expected.must_fail) {
      if (!failed.has(ruleId)) bump(ruleId, "misses");
    }
  }

  // A judged finding is only as good as its quote: evidence must be the page's
  // own words (the same check production applies before a fail can count). Deterministic findings carry crawl data instead
  // of quotes, so they are left out.
  let quotes = 0;
  const ungrounded: UngroundedQuote[] = [];
  for (const { goldenCase, evaluation, run } of completed) {
    const settled = planEvaluation(goldenCase.page).settled;
    for (const finding of evaluation.findings) {
      if (settled.has(finding.ruleId) || !finding.evidence?.trim()) continue;
      if (finding.status !== "fail" && finding.status !== "warn") continue;
      quotes += 1;
      if (!isGroundedQuote(finding.evidence, goldenCase.page)) {
        ungrounded.push({
          caseId: goldenCase.id,
          run,
          ruleId: finding.ruleId,
          evidence: finding.evidence,
        });
      }
    }
  }

  // Stability: a case whose runs disagree on the verdict.
  const verdictsByCase = new Map<string, Set<string>>();
  for (const { caseId, evaluation } of completed) {
    const verdicts = verdictsByCase.get(caseId) ?? new Set<string>();
    verdicts.add(evaluation.verdict);
    verdictsByCase.set(caseId, verdicts);
  }
  const unstableCases = [...verdictsByCase]
    .filter(([, verdicts]) => verdicts.size > 1)
    .map(([caseId]) => caseId);

  return {
    evaluations: completed.length,
    errors: results.length - completed.length,
    casesWithProblems: new Set(
      results
        .filter((result) => result.problems.length > 0)
        .map((result) => result.caseId),
    ).size,
    falseRejectRate: ratio(falseRejects.length, legit.length),
    // Without a judge no spam case can reach its verdict, so recall is not
    // measured rather than reported as a failure.
    spamRecall: judged ? ratio(caught.length, spam.length) : null,
    perRule: sort(
      [...perRule].map(([ruleId, counts]) => ({ ruleId, ...counts })),
      (a, b) => b.falseFails - a.falseFails || b.misses - a.misses,
    ),
    evidenceGrounding: ratio(quotes - ungrounded.length, quotes),
    ungrounded,
    // One run cannot disagree with itself.
    verdictStability:
      runs > 1
        ? ratio(verdictsByCase.size - unstableCases.length, verdictsByCase.size)
        : null,
    unstableCases,
  };
}

function printReport({
  cases,
  results,
  judges,
  runs,
  report,
  failedGates,
}: {
  cases: GoldenCase[];
  results: RunResult[];
  judges: string;
  runs: number;
  report: ReturnType<typeof score>;
  failedGates: string[];
}) {
  console.log(
    `Guideline golden eval · catalog ${CATALOG_VERSION} · judges: ${judges} · ${cases.length} cases × ${runs} run(s)\n`,
  );
  for (const goldenCase of cases) {
    const own = results.filter((result) => result.caseId === goldenCase.id);
    const { verdict_max, verdict_min } = goldenCase.expected;
    const expected = verdict_max ? `<= ${verdict_max}` : `>= ${verdict_min}`;
    const verdicts = own
      .map((result) => result.evaluation?.verdict ?? "ERROR")
      .join(" / ");
    const issues = [
      ...new Set(
        own.flatMap((result) =>
          result.error ? [`error: ${result.error}`] : result.problems,
        ),
      ),
    ];
    console.log(
      `${issues.length > 0 ? "FAIL" : "ok  "} ${goldenCase.id.padEnd(40)} ${expected.padEnd(24)} ${verdicts}`,
    );
    for (const issue of issues) console.log(`       - ${issue}`);
  }

  console.log("\nMetrics");
  console.log(
    `  false-reject rate (legit)  ${formatRate(report.falseRejectRate)}   gate ${percent(MAX_FALSE_REJECT_RATE)}`,
  );
  console.log(
    `  spam recall                ${formatRate(report.spamRecall)}   gate >= ${percent(MIN_SPAM_RECALL)}`,
  );
  console.log(
    `  evidence grounding         ${formatRate(report.evidenceGrounding)}   ${report.ungrounded.length} ungrounded quote(s)`,
  );
  console.log(
    `  verdict stability          ${formatRate(report.verdictStability)}   ${runs > 1 ? `unstable: ${report.unstableCases.join(", ") || "none"}` : "needs --runs 2 or more"}`,
  );
  console.log(
    `  cases with problems        ${report.casesWithProblems}   errors: ${report.errors}`,
  );
  if (report.perRule.length > 0) {
    console.log("\nPer rule (false fails / misses)");
    for (const { ruleId, falseFails, misses } of report.perRule) {
      console.log(`  ${ruleId.padEnd(10)} ${falseFails} / ${misses}`);
    }
  }
  // The first few name the pattern; --json has them all.
  for (const quote of report.ungrounded.slice(0, 10)) {
    console.log(
      `  ungrounded ${quote.caseId} ${quote.ruleId}: "${quote.evidence.slice(0, 120)}"`,
    );
  }
  console.log(
    failedGates.length > 0
      ? `\nGATES FAILED: ${failedGates.join("; ")}`
      : "\nAll gates passed.",
  );
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function formatRate(value: number | null): string {
  return (value === null ? "n/a" : percent(value)).padEnd(6);
}
