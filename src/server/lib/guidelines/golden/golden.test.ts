import { sort } from "remeda";
import { describe, expect, it } from "vitest";
import { computeVerdict } from "@/shared/guidelines/catalog";
import type { JudgedRule, RuleJudge } from "../judge";
import {
  evaluatePage,
  outcomesFromSubmission,
  planEvaluation,
  summarizeEvaluation,
} from "../page-evaluator";
import { GOLDEN_CASES, caseProblems, type GoldenCase } from "./golden-cases";

/** A perfect judge: fails exactly the case's must_fail rules, with a quote. */
function oracleAnswers(
  goldenCase: GoldenCase,
  rules: readonly { id: string }[],
): JudgedRule[] {
  return rules.map((rule) =>
    goldenCase.expected.must_fail.includes(rule.id)
      ? { ruleId: rule.id, status: "fail", evidence: goldenCase.page.title }
      : { ruleId: rule.id, status: "pass" },
  );
}

function oracleJudge(goldenCase: GoldenCase): RuleJudge {
  return {
    name: "llm",
    modelId: "oracle",
    judge: async ({ rules }) => oracleAnswers(goldenCase, rules),
  };
}

describe("guideline golden cases", () => {
  it.each(GOLDEN_CASES)("$id", async (goldenCase) => {
    const { page } = goldenCase;
    const withoutJudge = await evaluatePage({ page });
    const withJudge = await evaluatePage({
      page,
      languageJudge: oracleJudge(goldenCase),
    });

    // The MCP submit path, through the same function the submit tool calls:
    // the caller reports only what does not pass, and silence is a pass.
    const plan = planEvaluation(page);
    const submitted = oracleAnswers(goldenCase, plan.askable).flatMap(
      (answer) =>
        answer.status === "fail"
          ? [
              {
                ruleId: answer.ruleId,
                status: "fail" as const,
                evidence: answer.evidence ?? undefined,
              },
            ]
          : [],
    );
    const viaMcp = summarizeEvaluation({
      page,
      classification: plan.classification,
      applicable: plan.applicable,
      outcomes: outcomesFromSubmission(plan, page, submitted).outcomes,
      judge: "mcp",
    });

    expect({
      withoutJudge: caseProblems(goldenCase, withoutJudge, { judged: false }),
      withJudge: caseProblems(goldenCase, withJudge, { judged: true }),
      mcpVerdict: viaMcp.verdict,
    }).toEqual({
      withoutJudge: [],
      withJudge: [],
      mcpVerdict: withJudge.verdict,
    });
  });

  // One judged `fail` on any of these rejects a page by itself, so each one is
  // a single point of false-reject exposure. Adding to this list should be a
  // deliberate catalog decision, not a side effect. Collected from what the
  // golden pages are asked, so the set needs a YMYL case and a review case.
  it("lists the judged rules whose failure alone rejects a page", () => {
    const judgedRuleIds = new Set(
      GOLDEN_CASES.flatMap(({ page }) =>
        planEvaluation(page).askable.map((rule) => rule.id),
      ),
    );
    const rejecting = sort(
      [...judgedRuleIds].filter(
        (id) => computeVerdict([{ id, status: "fail" }]).verdict === "reject",
      ),
      (a, b) => a.localeCompare(b),
    );

    expect(rejecting).toEqual([
      "EAT-04",
      "QRG-01",
      "SPAM-09",
      "SPAM-10",
      "SPAM-16",
      "SPAM-17",
      "YMYL-02", // YMYL pages only
      "YMYL-03", // YMYL pages only
    ]);
  });
});
