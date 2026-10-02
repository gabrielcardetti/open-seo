/**
 * Verdicts per search engine, read back from stored evaluations.
 *
 * One evaluation row per URL holds every engine's answers, and its stored
 * verdict weighs them all. An evaluation judged for one engine shows its
 * stored verdict as is; for one judged for several, readers that show Google
 * and Bing side by side recompute each engine's verdict from the stored rule
 * results, which needs no schema change.
 */
import {
  RULES_BY_ID,
  engineVerdictFromResults,
  evaluatedEngines,
  type Engine,
  type GuidelineRule,
  type Verdict,
} from "./catalog";

interface StoredEvaluation {
  verdict: Verdict;
  errorMessage: string | null;
}

interface StoredResult {
  ruleId: string;
  status: "fail" | "warn" | "unknown";
  severity: GuidelineRule["severity"];
}

/**
 * One evaluation's verdict for each engine it was judged for. A row that
 * failed to evaluate has no results to read; it keeps its stored verdict for
 * the engines the audit asked for. A row judged for one engine (every audit
 * before Bing's rules, and every Google-only one since) keeps its stored
 * verdict too: it is exactly that engine's, and recomputing it could only
 * drift from what the audit reported, for instance once the catalog retires
 * a rule the verdict rests on.
 */
export function verdictsByEngine(
  evaluation: StoredEvaluation,
  results: readonly StoredResult[],
  auditEngines: readonly Engine[],
): Partial<Record<Engine, Verdict>> {
  if (evaluation.errorMessage) {
    return Object.fromEntries(
      auditEngines.map((engine) => [engine, evaluation.verdict]),
    );
  }
  const engines = evaluatedEngines(results, auditEngines);
  if (engines.length === 1) return { [engines[0]]: evaluation.verdict };
  return Object.fromEntries(
    engines.map((engine) => [
      engine,
      engineVerdictFromResults(results, engine).verdict,
    ]),
  );
}

/**
 * How a rule that is one engine's preference against another's reads: the
 * engine that prefers it, then what the other says (the catalog's note).
 * Null for a rule the engines agree on.
 */
export function conflictNote(ruleId: string): string | null {
  const notes = RULES_BY_ID.get(ruleId)?.conflicts_with?.map((c) => c.note);
  return notes?.length ? notes.join(" ") : null;
}
