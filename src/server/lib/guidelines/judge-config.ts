/**
 * Picks the judges from what the deployment actually has.
 *
 * Both are optional and they degrade independently:
 *
 * - no decision model: the language model judges every rule, which costs more
 *   but works;
 * - no API key: the language model is skipped, so findings carry a verdict and
 *   a confidence but no quote;
 * - neither: only the deterministic rules are answered and everything else is
 *   recorded as `unknown`. The audit still completes and says so.
 *
 * Nothing here throws on a missing judge. A self-host with no keys configured
 * should get a smaller answer, not a failed audit.
 */
import { env } from "cloudflare:workers";
import { getEnvValueSync, getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { RuleJudge } from "./judge";
import {
  classifierDevTransport,
  workersAiTransport,
  type AiBinding,
  type DecisionTransport,
} from "./decision-transport";
import { JevJudge } from "./jev-judge";
import { LlmJudge } from "./llm-judge";

/** Sensible default: cheap, fast, and adequate once a decision model pre-filters. */
const DEFAULT_JUDGE_MODEL = "openai/gpt-5.6-luna";

interface ResolvedJudges {
  decisionJudge: RuleJudge | null;
  languageJudge: RuleJudge | null;
}

/** True when a value exposes the one method this judge calls. */
function isAiBinding(value: unknown): value is AiBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "run" in value &&
    typeof (value as { run: unknown }).run === "function"
  );
}

function aiBinding(): AiBinding | null {
  // The binding is optional: a deployment without Workers AI configured simply
  // has no decision model, which the caller handles.
  const candidate = Reflect.get(env, "AI") as unknown;
  return isAiBinding(candidate) ? candidate : null;
}

/**
 * Which route reaches Jev, from GUIDELINES_DECISION_MODEL:
 *
 * - `classifier` (default): classifier.dev. Free and keyless, so it works on a
 *   fresh deploy with nothing configured; the trade-off is that page text goes
 *   to a third party and anonymous calls share a rate limit.
 * - `gateway`: Workers AI through the authenticated AI Gateway. Needs the `AI`
 *   binding, AI_GATEWAY_ID, and unified-billing balance on the gateway.
 * - `none`: no decision model.
 *
 * A route whose prerequisites are missing resolves to no decision model rather
 * than failing; the audit then leans on the language model.
 */
async function resolveDecisionTransport(): Promise<DecisionTransport | null> {
  const route =
    (await getOptionalEnvValue("GUIDELINES_DECISION_MODEL")) ?? "classifier";
  if (route === "none") return null;
  if (route === "gateway") {
    const ai = aiBinding();
    const gatewayId = await getOptionalEnvValue("AI_GATEWAY_ID");
    return ai && gatewayId ? workersAiTransport(ai, gatewayId) : null;
  }
  return classifierDevTransport({
    apiKey: getEnvValueSync(env, "CLASSIFIER_API_KEY"),
  });
}

export async function resolveJudges(): Promise<ResolvedJudges> {
  // GUIDELINES_JUDGE forces one instrument, for comparing them against the
  // same pages without redeploying.
  const forced = await getOptionalEnvValue("GUIDELINES_JUDGE");

  const transport = forced === "llm" ? null : await resolveDecisionTransport();
  const decisionJudge = transport ? new JevJudge(transport) : null;

  let languageJudge: RuleJudge | null = null;
  if (forced !== "jev") {
    const apiKey =
      getEnvValueSync(env, "GUIDELINES_API_KEY") ??
      getEnvValueSync(env, "OPENROUTER_API_KEY");
    if (apiKey) {
      languageJudge = new LlmJudge({
        apiKey,
        model:
          (await getOptionalEnvValue("GUIDELINES_MODEL")) ??
          DEFAULT_JUDGE_MODEL,
        baseUrl: await getOptionalEnvValue("GUIDELINES_BASE_URL"),
      });
    }
  }

  return { decisionJudge, languageJudge };
}
