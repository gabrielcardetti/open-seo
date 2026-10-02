import { sort } from "remeda";
import { useMemo, useState, type ReactNode } from "react";
import { FileText, ListChecks, Search, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { Label } from "@/client/components/ui/label";
import {
  RULES_BY_ID,
  type Engine,
  type Verdict,
} from "@/shared/guidelines/catalog";
import {
  ENGINE_LABEL,
  EngineSummary,
  tallyVerdicts,
  useEngineVerdicts,
} from "./GuidelineEngines";
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

const VIEW_MODES: { value: ViewMode; label: string; icon: ReactNode }[] = [
  { value: "pages", label: "By page", icon: <FileText /> },
  { value: "rules", label: "By rule", icon: <ListChecks /> },
];

export function GuidelinesView({
  evaluations: allEvaluations,
  results: allResults,
  engines: auditEngines,
}: {
  evaluations: GuidelineEvaluationRow[];
  results: GuidelineResultRow[];
  engines: Engine[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("pages");
  const [verdicts, setVerdicts] = useState<ReadonlySet<Verdict>>(new Set());
  const [ymylOnly, setYmylOnly] = useState(false);
  const [query, setQuery] = useState("");
  const engineVerdicts = useEngineVerdicts(
    allEvaluations,
    allResults,
    auditEngines,
  );
  const [chosenEngine, setEngine] = useState<Engine | null>(null);
  const engine =
    chosenEngine ??
    (engineVerdicts.judged.includes("google") ? "google" : "bing");

  // The view is one engine's: its verdicts, and its rules' findings. Rows not
  // judged for it are left out rather than shown with another engine's verdict.
  const { evaluations, results } = useMemo(
    () => ({
      evaluations: allEvaluations.flatMap((evaluation) => {
        const verdict = engineVerdicts.verdicts.get(evaluation.id)?.[engine];
        return verdict ? [{ ...evaluation, verdict }] : [];
      }),
      results: allResults.filter((result) =>
        RULES_BY_ID.get(result.ruleId)?.engines.includes(engine),
      ),
    }),
    [allEvaluations, allResults, engineVerdicts, engine],
  );
  const otherVerdicts = (evaluationId: string) =>
    engineVerdicts.judged
      .filter((other) => other !== engine)
      .flatMap((other) => {
        const verdict = engineVerdicts.verdicts.get(evaluationId)?.[other];
        return verdict ? [{ label: ENGINE_LABEL[other], verdict }] : [];
      });

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

  const counts = useMemo(
    () => tallyVerdicts(pages.map((page) => page.verdict)),
    [pages],
  );

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
      <EmptyState
        variant="plain"
        title="No content-guideline evaluation yet."
        description={
          <>
            Start an audit with &ldquo;Evaluate content against Google&rsquo;s
            guidelines&rdquo; turned on (Bing&rsquo;s can be added there), or
            judge the pages with your own model over MCP
            (get_guidelines_evaluation_batch).
          </>
        }
      />
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
      otherVerdicts={otherVerdicts(evaluation.id)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        {engineVerdicts.judged.length > 1 && (
          <EngineSummary
            engine={engine}
            onChange={(next) => {
              setEngine(next);
              setVerdicts(new Set());
            }}
            tallies={engineVerdicts.judged.map((judged) => ({
              engine: judged,
              counts: tallyVerdicts(
                allEvaluations
                  .filter((evaluation) => evaluation.pageType !== "site")
                  .map(
                    (evaluation) =>
                      engineVerdicts.verdicts.get(evaluation.id)?.[judged],
                  ),
              ),
            }))}
          />
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm">
            <span className="font-medium tabular-nums">{pages.length}</span>{" "}
            page{pages.length === 1 ? "" : "s"} judged
            {judges.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · by {judges.join(", ")}
              </span>
            )}
          </p>
        </div>

        {pages.length > 0 && (
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
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
                <Badge
                  key={verdict}
                  variant={VERDICT_STYLE[verdict].variant}
                  render={<button type="button" />}
                  onClick={() => toggleVerdict(verdict)}
                  aria-pressed={active}
                  className={`gap-1.5 cursor-pointer ${
                    verdicts.size > 0 && !active ? "opacity-40" : ""
                  }`}
                >
                  {VERDICT_STYLE[verdict].label}
                  <span className="tabular-nums font-semibold">
                    {counts[verdict]}
                  </span>
                </Badge>
              );
            },
          )}
          {verdicts.size > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setVerdicts(new Set())}
            >
              Clear
            </Button>
          )}
        </div>

        {decisionOnly && (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription>
              Only the decision model judged these pages. It can flag problems
              but cannot quote the page, so none of its findings can block a
              page: treat them as leads. For confirmed verdicts, configure a
              language model for the audit, or judge the pages with your own
              model over MCP.
            </AlertDescription>
          </Alert>
        )}
      </section>

      {site && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 bg-muted/50 px-4 py-1.5 border-b border-border">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Site-wide patterns
            </span>
          </div>
          <ul>{item(site)}</ul>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-3 py-2 border-b border-border">
          <SegmentedToggle
            showLabels
            items={VIEW_MODES}
            value={mode}
            onChange={setMode}
          />
          <InputGroup className="h-7 flex-1 min-w-[10rem] max-w-xs bg-card">
            <InputGroupAddon>
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Filter by URL"
              aria-label="Filter by URL"
              className="text-xs md:text-xs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          <Label className="text-xs font-normal cursor-pointer">
            <Checkbox
              checked={ymylOnly}
              onCheckedChange={(checked) => setYmylOnly(checked)}
            />
            YMYL only
          </Label>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {visiblePages.length} of {pages.length}
          </span>
        </div>

        {mode === "pages" ? (
          visiblePages.length > 0 ? (
            <ul className="divide-y divide-border">{visiblePages.map(item)}</ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">
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
