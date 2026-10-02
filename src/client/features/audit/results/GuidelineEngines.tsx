/**
 * Google and Bing side by side in the guideline tab: each evaluation's verdict
 * per engine, recomputed from its stored results, and the switch between the
 * two engines' views.
 */
import { useMemo } from "react";
import { Scale } from "lucide-react";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import {
  ENGINES,
  type Engine,
  type Verdict,
} from "@/shared/guidelines/catalog";
import { verdictsByEngine } from "@/shared/guidelines/engine-verdicts";
import {
  VERDICT_STYLE,
  type GuidelineEvaluationRow,
  type GuidelineResultRow,
} from "./GuidelineEvaluationItem";
import { VERDICT_ORDER } from "./guideline-view-model";

export const ENGINE_LABEL: Record<Engine, string> = {
  google: "Google",
  bing: "Bing",
};

/**
 * Each evaluation's verdict per engine it was judged for, recomputed from its
 * stored results (one row holds both engines' answers).
 */
export function useEngineVerdicts(
  evaluations: GuidelineEvaluationRow[],
  results: GuidelineResultRow[],
  auditEngines: Engine[],
) {
  return useMemo(() => {
    const byEvaluation = new Map<string, GuidelineResultRow[]>();
    for (const result of results) {
      const bucket = byEvaluation.get(result.evaluationId);
      if (bucket) bucket.push(result);
      else byEvaluation.set(result.evaluationId, [result]);
    }
    const verdicts = new Map(
      evaluations.map((evaluation) => [
        evaluation.id,
        verdictsByEngine(
          evaluation,
          byEvaluation.get(evaluation.id) ?? [],
          auditEngines,
        ),
      ]),
    );
    const judged = ENGINES.filter((engine) =>
      [...verdicts.values()].some((byEngine) => byEngine[engine]),
    );
    return { verdicts, judged };
  }, [evaluations, results, auditEngines]);
}

export function tallyVerdicts(
  verdicts: ReadonlyArray<Verdict | undefined>,
): Record<Verdict, number> {
  const tally: Record<Verdict, number> = {
    pass: 0,
    pass_with_warnings: 0,
    revise: 0,
    reject: 0,
  };
  for (const verdict of verdicts) if (verdict) tally[verdict] += 1;
  return tally;
}

/**
 * Google's and Bing's page verdicts side by side, and which engine the list
 * below shows. A rule both engines state counts in both.
 */
export function EngineSummary({
  engine,
  onChange,
  tallies,
}: {
  engine: Engine;
  onChange: (engine: Engine) => void;
  tallies: Array<{ engine: Engine; counts: Record<Verdict, number> }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedToggle
        showLabels
        items={tallies.map((tally) => ({
          value: tally.engine,
          label: ENGINE_LABEL[tally.engine],
          icon: <Scale />,
        }))}
        value={engine}
        onChange={onChange}
      />
      {tallies.map(({ engine: judged, counts }) => (
        <span key={judged} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {ENGINE_LABEL[judged]}:
          </span>{" "}
          {VERDICT_ORDER.filter((verdict) => counts[verdict] > 0)
            .map(
              (verdict) => `${counts[verdict]} ${VERDICT_STYLE[verdict].label}`,
            )
            .join(" · ") || "no pages"}
        </span>
      ))}
    </div>
  );
}
