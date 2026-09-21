/**
 * Decision-model judge: Jev on Workers AI.
 *
 * Jev answers a map of typed questions about one `state` in a single call,
 * every question in parallel, and returns a value plus a calibrated confidence
 * for each. That shape maps almost one-to-one onto the catalog — a rule is a
 * question, its `pass_if`/`fail_if` are the criteria — which is what makes it
 * possible to judge forty rules for a fraction of a cent.
 *
 * Its limit is that it returns values, never prose: no quote, no explanation.
 * A `fail` from here is a signal to look, not a finding to publish; the
 * language-model pass turns it into one.
 *
 * Runs through the `AI` binding rather than TypeSafe's own API so the audit
 * worker needs no extra key and makes no third-party egress.
 */
import { z } from "zod";
import type { GuidelineRule } from "@/shared/guidelines/catalog";
import {
  instructionsFor,
  questionFor,
  statusFromAnswer,
} from "@/shared/guidelines/judge-map";
import {
  renderPageState,
  type JudgeInput,
  type JudgedRule,
  type RuleJudge,
} from "./judge";

const JEV_MODEL = "typesafe/jev";

/**
 * Questions per call. The API caps a request at 20 named questions, and the
 * catalog can apply more than that to one page, so a page is judged in batches.
 */
const QUESTIONS_PER_CALL = 20;

/** Rule ids carry hyphens; question keys have to survive a JSON object key. */
const keyFor = (ruleId: string) => ruleId.replace(/-/g, "_");
const ruleIdFrom = (key: string) => key.replace(/_/g, "-");

const answerSchema = z.object({
  type: z.string().optional(),
  noul: z.number().optional(),
  choice: z.string().optional(),
  score: z.number().optional(),
  confidence: z.number().nullable().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

/** Minimal shape of the Workers AI binding this judge needs. */
export interface AiBinding {
  run(
    model: string,
    input: unknown,
    options?: { gateway?: { id: string } },
  ): Promise<unknown>;
}

function buildQuestions(
  rules: readonly GuidelineRule[],
): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  for (const rule of rules) {
    const question = questionFor(rule);
    const instructions = instructionsFor(rule);
    if (question.kind === "binary") {
      questions[keyFor(rule.id)] = {
        type: "noul",
        instructions,
        criteria: { true: rule.fail_if, false: rule.pass_if },
      };
    } else if (question.kind === "score") {
      questions[keyFor(rule.id)] = {
        type: "score",
        instructions,
        criteria: Object.fromEntries(
          question.levels.map((level, index) => [String(index + 1), level]),
        ),
      };
    } else {
      questions[keyFor(rule.id)] = {
        type: "choice",
        instructions,
        criteria: Object.fromEntries(
          question.options.map((option) => [option, option]),
        ),
      };
    }
  }
  return questions;
}

/**
 * Read one answer back into the catalog's vocabulary.
 *
 * `noul` is the probability that the *failing* condition holds — the criteria
 * are built that way above — so it is inverted into a pass/fail label before
 * the shared status mapping applies its confidence floor.
 */
function toJudged(
  rule: GuidelineRule,
  answer: z.infer<typeof answerSchema>,
): JudgedRule {
  const question = questionFor(rule);
  const confidence = answer.confidence ?? null;

  if (question.kind === "binary") {
    const failProbability = answer.noul;
    const label =
      typeof failProbability === "number"
        ? failProbability >= 0.5
          ? "fail"
          : "pass"
        : undefined;
    // With no calibrated confidence, the margin from 50/50 is the next best
    // thing: a 0.52 is a coin flip whatever the label says.
    const derived =
      confidence ??
      (typeof failProbability === "number"
        ? Math.abs(failProbability - 0.5) * 2
        : 0);
    return {
      ruleId: rule.id,
      status: statusFromAnswer(rule, { label, confidence: derived }),
      confidence: derived,
      evidence: null,
      reason: null,
    };
  }

  if (question.kind === "score") {
    const score =
      typeof answer.score === "number" ? Math.round(answer.score) : null;
    return {
      ruleId: rule.id,
      status: statusFromAnswer(rule, {
        index: score === null ? undefined : score - 1,
        confidence,
      }),
      score,
      confidence,
      evidence: null,
      reason: null,
    };
  }

  return {
    ruleId: rule.id,
    status: statusFromAnswer(rule, { label: answer.choice, confidence }),
    confidence,
    evidence: null,
    reason: null,
  };
}

export class JevJudge implements RuleJudge {
  readonly name = "jev" as const;
  readonly modelId = JEV_MODEL;

  /**
   * Jev is a third-party model billed through Cloudflare's unified billing,
   * which refuses requests that do not arrive through an AI Gateway with
   * authentication enabled. The binding authenticates on its own; it only has
   * to be told which gateway to route through.
   */
  constructor(
    private readonly ai: AiBinding,
    private readonly gatewayId: string,
  ) {}

  async judge({
    page,
    rules,
    businessOverview,
  }: JudgeInput): Promise<JudgedRule[]> {
    if (rules.length === 0) return [];
    const state = renderPageState(page, businessOverview);
    const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
    const results: JudgedRule[] = [];

    for (let i = 0; i < rules.length; i += QUESTIONS_PER_CALL) {
      const batch = rules.slice(i, i + QUESTIONS_PER_CALL);
      const raw = await this.ai.run(
        JEV_MODEL,
        { state, questions: buildQuestions(batch) },
        { gateway: { id: this.gatewayId } },
      );
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) {
        // A malformed batch leaves its rules unanswered rather than taking the
        // page down; the second pass picks them up as `unknown`.
        for (const rule of batch) {
          results.push({
            ruleId: rule.id,
            status: "unknown",
            confidence: null,
            reason: "The decision model returned an unreadable answer.",
          });
        }
        continue;
      }
      for (const [key, answer] of Object.entries(parsed.data.answers)) {
        const rule = rulesById.get(ruleIdFrom(key));
        if (!rule) continue;
        results.push(toJudged(rule, answer));
      }
    }
    return results;
  }
}
