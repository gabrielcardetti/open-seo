import { sort } from "remeda";
import { useMemo, useState } from "react";
import type { Verdict } from "@/shared/guidelines/catalog";
import {
  GuidelineEvaluationItem,
  VERDICT_STYLE,
  type GuidelineEvaluationRow,
  type GuidelineResultRow,
} from "@/client/features/audit/results/GuidelineEvaluationItem";

const VERDICT_ORDER: Verdict[] = [
  "reject",
  "revise",
  "pass_with_warnings",
  "pass",
];

export function GuidelinesView({
  evaluations,
  results,
}: {
  evaluations: GuidelineEvaluationRow[];
  results: GuidelineResultRow[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const findingsByEvaluation = useMemo(() => {
    const map = new Map<string, GuidelineResultRow[]>();
    for (const result of results) {
      // `unknown` is the absence of an answer, not a finding. It is reported as
      // a count on the page instead, so the verdict's coverage stays visible
      // without filling the list with non-answers.
      if (result.status === "unknown") continue;
      const bucket = map.get(result.evaluationId);
      if (bucket) bucket.push(result);
      else map.set(result.evaluationId, [result]);
    }
    return map;
  }, [results]);

  // The whole-site row is not a page: it is pinned on top and kept out of the
  // per-page tallies.
  const site = evaluations.find((evaluation) => evaluation.pageType === "site");
  const pages = useMemo(
    () =>
      sort(
        evaluations.filter((evaluation) => evaluation.pageType !== "site"),
        (a, b) =>
          VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) ||
          a.pageUrl.localeCompare(b.pageUrl),
      ),
    [evaluations],
  );

  const counts = useMemo(() => {
    const tally: Record<Verdict, number> = {
      pass: 0,
      pass_with_warnings: 0,
      revise: 0,
      reject: 0,
    };
    for (const page of pages) tally[page.verdict] += 1;
    return tally;
  }, [pages]);

  if (evaluations.length === 0) {
    return (
      <p className="text-sm text-base-content/70 py-6">
        This audit has no content-guideline evaluation. Start an audit with
        &ldquo;Evaluate content against Google&rsquo;s guidelines&rdquo; turned
        on to get one.
      </p>
    );
  }

  const item = (evaluation: GuidelineEvaluationRow) => (
    <GuidelineEvaluationItem
      key={evaluation.id}
      evaluation={evaluation}
      findings={findingsByEvaluation.get(evaluation.id) ?? []}
      isOpen={expanded === evaluation.id}
      onToggle={() =>
        setExpanded(expanded === evaluation.id ? null : evaluation.id)
      }
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {site && (
        <ul className="flex flex-col border-b border-base-300">{item(site)}</ul>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {VERDICT_ORDER.filter((verdict) => counts[verdict] > 0).map(
          (verdict) => (
            <span
              key={verdict}
              className={`badge ${VERDICT_STYLE[verdict].className}`}
            >
              {VERDICT_STYLE[verdict].label}: {counts[verdict]}
            </span>
          ),
        )}
      </div>

      <ul className="flex flex-col divide-y divide-base-300">
        {pages.map(item)}
      </ul>
    </div>
  );
}
