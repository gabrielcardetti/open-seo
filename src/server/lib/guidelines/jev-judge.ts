/**
 * Decision-model judge: Jev.
 *
 * Jev answers a map of typed questions about one page in a single call and
 * returns a value plus a calibrated confidence for each. That shape maps almost
 * one-to-one onto the catalog — a rule is a question, its `pass_if`/`fail_if`
 * are the criteria — which is what makes judging seventy rules nearly free.
 *
 * Its limit is that it returns values, never prose: no quote, no explanation.
 * A `fail` from here is a signal to look, not a finding to publish; the
 * language-model pass or the MCP judge turns it into one.
 *
 * How the questions reach Jev is the transport's business (see
 * decision-transport.ts): Workers AI through an AI Gateway, or classifier.dev.
 */
import { statusFromAnswer } from "@/shared/guidelines/judge-map";
import type { DecisionTransport } from "./decision-transport";
import {
  renderSubject,
  type JudgeInput,
  type JudgedRule,
  type RuleJudge,
} from "./judge";

export class JevJudge implements RuleJudge {
  readonly name = "jev" as const;
  readonly modelId: string;

  constructor(private readonly transport: DecisionTransport) {
    this.modelId = transport.modelId;
  }

  /** Pages only in practice: the site pass never asks Jev (see `evaluateSite`). */
  async judge(input: JudgeInput): Promise<JudgedRule[]> {
    const { rules } = input;
    if (rules.length === 0) return [];
    const answers = await this.transport.ask(renderSubject(input), rules);

    return rules.map((rule) => {
      const answer = answers.get(rule.id);
      if (!answer) {
        // Unanswered is not a pass: the rule goes on to the second judge as
        // `unknown` instead of disappearing from the evaluation.
        return {
          ruleId: rule.id,
          status: "unknown" as const,
          confidence: null,
          reason: "The decision model returned no answer for this rule.",
        };
      }
      return {
        ruleId: rule.id,
        status: statusFromAnswer(rule, answer),
        // Stored 1-based to match the catalog's 1-5 vocabulary.
        score: answer.index === undefined ? null : answer.index + 1,
        confidence: answer.confidence,
        evidence: null,
        reason: null,
      };
    });
  }
}
