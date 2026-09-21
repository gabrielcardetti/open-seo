/**
 * How a question reaches the decision model.
 *
 * The model is the same either way — Jev, TypeSafe's typed-decision model —
 * but it can be reached two ways, and they differ in cost, setup and wire
 * format:
 *
 * - `workers-ai`: Cloudflare Workers AI through an authenticated AI Gateway.
 *   Billed per token through unified billing, so it needs gateway balance, but
 *   it stays inside Cloudflare and sends the typed primitives (noul, score,
 *   choice) natively.
 * - `classifier`: classifier.dev, a free public front for Jev that takes
 *   labelled dimensions instead of typed primitives. No key, no balance —
 *   but it is a third-party service, so page text leaves Cloudflare, and it is
 *   rate limited per caller.
 *
 * Both return answers already translated into the rule's own vocabulary (a
 * label or a level index, plus a confidence), so the judge above them never
 * learns which one it used.
 */
import { z } from "zod";
import type { GuidelineRule } from "@/shared/guidelines/catalog";
import { instructionsFor, questionFor } from "@/shared/guidelines/judge-map";

/** One answer, in the vocabulary of the rule's question. */
export interface DecisionAnswer {
  /** "pass"/"fail" for binary rules, an option for choice rules. */
  label?: string;
  /** 0-based level for score rules. */
  index?: number;
  /** Margin between the top two answers; null when the model gave none. */
  confidence: number | null;
}

export interface DecisionTransport {
  /** Recorded on the evaluation, so verdicts are attributable to a route. */
  readonly modelId: string;
  ask(
    state: string,
    rules: readonly GuidelineRule[],
  ): Promise<Map<string, DecisionAnswer>>;
}

/**
 * Both routes cap a request at 20 named questions, and a page can have seventy
 * applicable rules, so pages are asked in batches.
 */
const QUESTIONS_PER_CALL = 20;

/** Rule ids carry hyphens; question keys must be plain identifiers. */
const keyFor = (ruleId: string) => ruleId.replace(/-/g, "_");

function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += QUESTIONS_PER_CALL) {
    out.push(items.slice(i, i + QUESTIONS_PER_CALL));
  }
  return out;
}

// ─── Retry ──────────────────────────────────────────────────────────────────

/** An upstream refusal worth distinguishing from a malformed answer. */
export class DecisionModelError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "DecisionModelError";
  }
}

/**
 * Rate limits and overloads pass; bad requests and missing balance do not.
 * Retrying a 402 would only spend the step's time budget failing the same way.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof DecisionModelError) {
    return (
      error.status === 429 ||
      error.status === 529 ||
      (error.status !== null && error.status >= 500)
    );
  }
  // The Workers AI binding throws plain errors; read the transient ones by
  // their message, and leave everything else (402 balance, 400) terminal.
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|529|rate limit|overloaded|timed? ?out|temporarily)\b/i.test(
    message,
  );
}

interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  /** No single wait may exceed this, whatever Retry-After asks for. */
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sized to fit inside the evaluation step's three-minute budget: four attempts
 * with waits capped at 20s cost at most a minute of backoff per batch.
 */
const DEFAULT_RETRY: RetryPolicy = {
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
};

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  call: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<T> {
  const sleep = policy.sleep ?? realSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      if (attempt === policy.attempts || !isRetryable(error)) throw error;
      const asked =
        error instanceof DecisionModelError ? error.retryAfterMs : null;
      const backoff = policy.baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.min(asked ?? backoff, policy.maxDelayMs));
    }
  }
  throw lastError;
}

// ─── Workers AI (through an authenticated AI Gateway) ───────────────────────

/** Minimal shape of the Workers AI binding this transport needs. */
export interface AiBinding {
  run(
    model: string,
    input: unknown,
    options?: { gateway?: { id: string } },
  ): Promise<unknown>;
}

const workersAiAnswerSchema = z.object({
  noul: z.number().optional(),
  choice: z.string().optional(),
  score: z.number().optional(),
  confidence: z.number().nullable().optional(),
});

const workersAiResponseSchema = z.object({
  answers: z.record(z.string(), workersAiAnswerSchema),
});

function typedQuestion(rule: GuidelineRule): Record<string, unknown> {
  const question = questionFor(rule);
  const instructions = instructionsFor(rule);
  if (question.kind === "binary") {
    // `noul` answers "does the criteria's `true` side hold?", so the failing
    // condition goes on `true` and the answer reads as P(fail).
    return {
      type: "noul",
      instructions,
      criteria: { true: rule.fail_if, false: rule.pass_if },
    };
  }
  if (question.kind === "score") {
    // An ordered array; the answer is a continuous 0-based position on it.
    return { type: "score", instructions, criteria: question.levels };
  }
  return {
    type: "choice",
    instructions,
    criteria: Object.fromEntries(
      question.options.map((option) => [option, `Page quality: ${option}`]),
    ),
  };
}

function fromWorkersAi(
  rule: GuidelineRule,
  answer: z.infer<typeof workersAiAnswerSchema>,
): DecisionAnswer {
  const question = questionFor(rule);
  if (question.kind === "binary") {
    const failProbability = answer.noul;
    if (typeof failProbability !== "number") return { confidence: null };
    // `noul` carries no confidence field; its distance from a coin flip is
    // the equivalent margin.
    return {
      label: failProbability >= 0.5 ? "fail" : "pass",
      confidence: answer.confidence ?? Math.abs(failProbability - 0.5) * 2,
    };
  }
  if (question.kind === "score") {
    if (typeof answer.score !== "number") return { confidence: null };
    return {
      index: Math.min(
        question.levels.length - 1,
        Math.max(0, Math.round(answer.score)),
      ),
      confidence: answer.confidence ?? null,
    };
  }
  return { label: answer.choice, confidence: answer.confidence ?? null };
}

const WORKERS_AI_JEV = "typesafe/jev";
const CLASSIFIER_DEV_JEV = "classifier.dev/jev";

/**
 * The judge ids a decision model records on its own. An evaluation carrying
 * only one of these has verdicts but no quoted evidence, so it still wants a
 * reading judge.
 */
export const DECISION_MODEL_IDS = [WORKERS_AI_JEV, CLASSIFIER_DEV_JEV] as const;

export function workersAiTransport(
  ai: AiBinding,
  gatewayId: string,
  retry: RetryPolicy = DEFAULT_RETRY,
): DecisionTransport {
  return {
    modelId: WORKERS_AI_JEV,
    async ask(state, rules) {
      const byKey = new Map(rules.map((rule) => [keyFor(rule.id), rule]));
      const answers = new Map<string, DecisionAnswer>();
      for (const batch of batches(rules)) {
        const questions = Object.fromEntries(
          batch.map((rule) => [keyFor(rule.id), typedQuestion(rule)]),
        );
        // Jev is billed through unified billing, which rejects calls that do
        // not arrive through an authenticated gateway.
        const raw = await withRetry(
          () =>
            ai.run(
              WORKERS_AI_JEV,
              { state, questions },
              { gateway: { id: gatewayId } },
            ),
          retry,
        );
        const parsed = workersAiResponseSchema.safeParse(raw);
        if (!parsed.success) continue;
        for (const [key, answer] of Object.entries(parsed.data.answers)) {
          const rule = byKey.get(key);
          if (rule) answers.set(rule.id, fromWorkersAi(rule, answer));
        }
      }
      return answers;
    },
  };
}

// ─── classifier.dev ─────────────────────────────────────────────────────────

const CLASSIFIER_DEV_URL = "https://classifier.dev/v1/classify";

const classifierDimensionSchema = z.object({
  label: z.string().nullish(),
  confidence: z.number().nullish(),
});

const classifierResponseSchema = z.object({
  results: z
    .array(
      z.object({
        dimensions: z.record(z.string(), classifierDimensionSchema).nullish(),
      }),
    )
    .min(1),
});

/**
 * The labels a dimension offers. Binary rules keep the plain "pass"/"fail"
 * pair that scored 26 of 26 on the benchmark controls; the question and both
 * criteria travel in the instructions.
 */
function labelsFor(rule: GuidelineRule): string[] {
  const question = questionFor(rule);
  if (question.kind === "binary") return ["pass", "fail"];
  return question.kind === "score" ? question.levels : question.options;
}

function fromClassifier(
  rule: GuidelineRule,
  answer: z.infer<typeof classifierDimensionSchema>,
): DecisionAnswer {
  const confidence = answer.confidence ?? null;
  const label = answer.label ?? undefined;
  const question = questionFor(rule);
  if (question.kind === "score") {
    const index = label ? question.levels.indexOf(label) : -1;
    return index >= 0 ? { index, confidence } : { confidence: null };
  }
  return { label, confidence };
}

function readRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function classifierDevTransport(
  options: {
    apiKey?: string | null;
    retry?: RetryPolicy;
    fetchImpl?: typeof fetch;
  } = {},
): DecisionTransport {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Optional: a workspace or Pro key raises the per-minute and daily limits
  // that apply to anonymous callers.
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  return {
    modelId: CLASSIFIER_DEV_JEV,
    async ask(state, rules) {
      const byKey = new Map(rules.map((rule) => [keyFor(rule.id), rule]));
      const answers = new Map<string, DecisionAnswer>();
      for (const batch of batches(rules)) {
        const dimensions = Object.fromEntries(
          batch.map((rule) => [
            keyFor(rule.id),
            { labels: labelsFor(rule), instructions: instructionsFor(rule) },
          ]),
        );
        const payload = await withRetry(async () => {
          const response = await doFetch(CLASSIFIER_DEV_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({
              items: [state],
              dimensions,
              model: "jev",
            }),
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new DecisionModelError(
              `classifier.dev returned ${response.status}: ${detail.slice(0, 200)}`,
              response.status,
              readRetryAfter(response),
            );
          }
          const body: unknown = await response.json();
          return body;
        }, options.retry ?? DEFAULT_RETRY);

        const parsed = classifierResponseSchema.safeParse(payload);
        const dims = parsed.success ? parsed.data.results[0]?.dimensions : null;
        if (!dims) continue;
        for (const [key, answer] of Object.entries(dims)) {
          const rule = byKey.get(key);
          if (rule) answers.set(rule.id, fromClassifier(rule, answer));
        }
      }
      return answers;
    },
  };
}
