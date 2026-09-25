import { sort } from "remeda";
import { useMemo, useState } from "react";
import { Search, TriangleAlert } from "lucide-react";
import type { Verdict } from "@/shared/guidelines/catalog";
import {
  GuidelineEvaluationItem,
  VERDICT_STYLE,
  type GuidelineEvaluationRow,
  type GuidelineResultRow,
} from "./GuidelineEvaluationItem";
import { GuidelineRuleGroups } from "./GuidelineRuleGroups";
import {
  VERDICT_ORDER,
  groupByRule,
  isDecisionOnly,
  judgeLabel,
} from "./guideline-view-model";

type ViewMode = "pages" | "rules";

export function GuidelinesView({
  evaluations,
  results,
}: {
  evaluations: GuidelineEvaluationRow[];
  results: GuidelineResultRow[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("pages");
  const [verdicts, setVerdicts] = useState<ReadonlySet<Verdict>>(new Set());
  const [ymylOnly, setYmylOnly] = useState(false);
  const [query, setQuery] = useState("");

  const { findingsByEvaluation, unansweredByEvaluation } = useMemo(() => {
    const findings = new Map<string, GuidelineResultRow[]>();
    const unanswered = new Map<string, GuidelineResultRow[]>();
    for (const result of results) {
      // `unknown` is the absence of an answer, not a finding: it is shown as
      // coverage under the page, never in the list of things to fix.
      const map = result.status === "unknown" ? unanswered : findings;
      const bucket = map.get(result.evaluationId);
      if (bucket) bucket.push(result);
      else map.set(result.evaluationId, [result]);
    }
    return {
      findingsByEvaluation: findings,
      unansweredByEvaluation: unanswered,
    };
  }, [results]);

  // The whole-site row is not a page: it is pinned on top and kept out of the
  // per-page tallies and filters.
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

  const visiblePages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pages.filter(
      (page) =>
        (verdicts.size === 0 || verdicts.has(page.verdict)) &&
        (!ymylOnly || page.ymyl) &&
        (!needle || page.pageUrl.toLowerCase().includes(needle)),
    );
  }, [pages, verdicts, ymylOnly, query]);

  const ruleGroups = useMemo(() => {
    const shown = new Set(visiblePages.map((page) => page.id));
    return groupByRule(
      visiblePages,
      results.filter((result) => shown.has(result.evaluationId)),
    );
  }, [visiblePages, results]);

  if (evaluations.length === 0) {
    return (
      <div className="py-10 text-center text-base-content/60">
        <p className="font-medium">No content-guideline evaluation yet.</p>
        <p className="text-sm mt-1">
          Start an audit with &ldquo;Evaluate content against Google&rsquo;s
          guidelines&rdquo; turned on, or judge the pages with your own model
          over MCP (get_guidelines_evaluation_batch).
        </p>
      </div>
    );
  }

  const judges = [...new Set(pages.map((page) => judgeLabel(page.judge)))];
  const decisionOnly =
    pages.length > 0 &&
    pages.every(
      (page) => isDecisionOnly(page.judge) || page.judge === "deterministic",
    ) &&
    pages.some((page) => isDecisionOnly(page.judge));

  const toggleVerdict = (verdict: Verdict) =>
    setVerdicts((current) => {
      const next = new Set(current);
      if (next.has(verdict)) next.delete(verdict);
      else next.add(verdict);
      return next;
    });

  const item = (evaluation: GuidelineEvaluationRow) => (
    <GuidelineEvaluationItem
      key={evaluation.id}
      evaluation={evaluation}
      findings={findingsByEvaluation.get(evaluation.id) ?? []}
      unanswered={unansweredByEvaluation.get(evaluation.id) ?? []}
      isOpen={expanded === evaluation.id}
      onToggle={() =>
        setExpanded(expanded === evaluation.id ? null : evaluation.id)
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm">
            <span className="font-medium tabular-nums">{pages.length}</span>{" "}
            page{pages.length === 1 ? "" : "s"} judged
            {judges.length > 0 && (
              <span className="text-base-content/55">
                {" "}
                · by {judges.join(", ")}
              </span>
            )}
          </p>
        </div>

        {pages.length > 0 && (
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-base-300"
            aria-hidden
          >
            {VERDICT_ORDER.map((verdict) =>
              counts[verdict] > 0 ? (
                <span
                  key={verdict}
                  className={VERDICT_STYLE[verdict].bar}
                  style={{
                    width: `${(counts[verdict] / pages.length) * 100}%`,
                  }}
                />
              ) : null,
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {VERDICT_ORDER.filter((verdict) => counts[verdict] > 0).map(
            (verdict) => {
              const active = verdicts.has(verdict);
              return (
                <button
                  key={verdict}
                  type="button"
                  onClick={() => toggleVerdict(verdict)}
                  aria-pressed={active}
                  className={`badge gap-1.5 cursor-pointer transition-opacity ${VERDICT_STYLE[verdict].className} ${
                    verdicts.size > 0 && !active ? "opacity-40" : ""
                  }`}
                >
                  {VERDICT_STYLE[verdict].label}
                  <span className="tabular-nums font-semibold">
                    {counts[verdict]}
                  </span>
                </button>
              );
            },
          )}
          {verdicts.size > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setVerdicts(new Set())}
            >
              Clear
            </button>
          )}
        </div>

        {decisionOnly && (
          <div role="alert" className="alert alert-warning alert-soft text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            <span>
              Only the decision model judged these pages. It can flag problems
              but cannot quote the page, so none of its findings can block a
              page: treat them as leads. For confirmed verdicts, configure a
              language model for the audit, or judge the pages with your own
              model over MCP.
            </span>
          </div>
        )}
      </section>

      {site && (
        <div className="border border-base-300 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 bg-base-200/60 px-4 py-1.5 border-b border-base-300/60">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
              Site-wide patterns
            </span>
          </div>
          <ul>{item(site)}</ul>
        </div>
      )}

      <div className="border border-base-300 rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 bg-base-200/60 px-3 py-2 border-b border-base-300/60">
          <div role="tablist" className="tabs tabs-box tabs-xs">
            <button
              type="button"
              role="tab"
              className={`tab ${mode === "pages" ? "tab-active" : ""}`}
              onClick={() => setMode("pages")}
            >
              By page
            </button>
            <button
              type="button"
              role="tab"
              className={`tab ${mode === "rules" ? "tab-active" : ""}`}
              onClick={() => setMode("rules")}
            >
              By rule
            </button>
          </div>
          <label className="input input-xs flex-1 min-w-[10rem] max-w-xs">
            <Search className="size-3 opacity-50" />
            <input
              type="search"
              placeholder="Filter by URL"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="label text-xs cursor-pointer gap-1.5">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={ymylOnly}
              onChange={(event) => setYmylOnly(event.target.checked)}
            />
            YMYL only
          </label>
          <span className="ml-auto text-xs tabular-nums text-base-content/50">
            {visiblePages.length} of {pages.length}
          </span>
        </div>

        {mode === "pages" ? (
          visiblePages.length > 0 ? (
            <ul className="divide-y divide-base-300/60">
              {visiblePages.map(item)}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-base-content/60">
              No page matches these filters.
            </p>
          )
        ) : (
          <GuidelineRuleGroups
            groups={ruleGroups}
            pageCount={visiblePages.length}
          />
        )}
      </div>
    </div>
  );
}
