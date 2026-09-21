/**
 * Picks the judges from what the deployment actually has.
 *
 * Both are optional and they degrade independently:
 *
 * - no `AI` binding: the decision model is skipped and the language model
 *   judges every rule, which costs more but works;
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
import { JevJudge, type AiBinding } from "./jev-judge";
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

export async function resolveJudges(): Promise<ResolvedJudges> {
  // GUIDELINES_JUDGE forces one instrument, for comparing them against the
  // same pages without redeploying.
  const forced = await getOptionalEnvValue("GUIDELINES_JUDGE");

  const ai = forced === "llm" ? null : aiBinding();
  const decisionJudge = ai ? new JevJudge(ai) : null;

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
