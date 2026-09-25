import { ChevronRight, ExternalLink } from "lucide-react";
import { sort } from "remeda";
import { RULES_BY_ID, type Verdict } from "@/shared/guidelines/catalog";
import { GuidelineFinding } from "./GuidelineFinding";
import { findingKind, unansweredByReason } from "./guideline-view-model";

export interface GuidelineEvaluationRow {
  id: string;
  pageUrl: string;
  verdict: Verdict;
  ymyl: boolean;
  pageType: string | null;
  unknownCount: number;
  judge: string | null;
  errorMessage: string | null;
}

export interface GuidelineResultRow {
  evaluationId: string;
  ruleId: string;
  status: "fail" | "warn" | "unknown";
  severity: "critical" | "high" | "medium" | "low";
  evidence: string | null;
  reason: string | null;
  remediation: string | null;
  confidence: number | null;
}

/**
 * Verdict styling. The four verdicts are an editorial decision, not a score:
 * "reject" means do not publish, so it reads as an error, while
 * "pass_with_warnings" is publishable and reads as neutral.
 */
export const VERDICT_STYLE: Record<
  Verdict,
  { label: string; className: string; bar: string }
> = {
  reject: { label: "Reject", className: "badge-error", bar: "bg-error" },
  revise: { label: "Revise", className: "badge-warning", bar: "bg-warning" },
  pass_with_warnings: {
    label: "Pass with warnings",
    className: "badge-ghost",
    bar: "bg-base-content/25",
  },
  pass: { label: "Pass", className: "badge-success", bar: "bg-success" },
};

const VERDICT_RULE: Record<Verdict, string> = {
  reject: "border-l-error/60",
  revise: "border-l-warning/60",
  pass_with_warnings: "border-l-base-content/20",
  pass: "border-l-success/50",
};

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** "2 fail · 3 unconfirmed", the row's one-line account of its findings. */
function findingSummary(findings: GuidelineResultRow[]): string {
  if (findings.length === 0) return "Nothing to fix";
  const fails = findings.filter((f) => f.status === "fail").length;
  const unconfirmed = findings.filter(
    (f) => findingKind(f) === "unconfirmed",
  ).length;
  const warnings = findings.length - fails - unconfirmed;
  return [
    fails && `${fails} failing`,
    warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`,
    unconfirmed && `${unconfirmed} unconfirmed`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One evaluated page, or the whole site, as a row that opens onto its
 * findings. The site row's URL is a sentinel (`<origin>/#site`), never shown
 * or linked: it is labelled instead.
 */
export function GuidelineEvaluationItem({
  evaluation,
  findings,
  unanswered,
  isOpen,
  onToggle,
}: {
  evaluation: GuidelineEvaluationRow;
  findings: GuidelineResultRow[];
  unanswered: GuidelineResultRow[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isSite = evaluation.pageType === "site";
  // Too little served text to judge (an app rendered in the browser): its
  // "pass" covers the page data only, and should not read as a clean page.
  const contentNotJudged =
    !isSite && evaluation.judge === "deterministic" && unanswered.length > 0;
  const ordered = sort(
    findings,
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.status === "fail" ? 0 : 1) - (b.status === "fail" ? 0 : 1),
  );
  // Leads the pipeline could not confirm go last and folded: on a page judged
  // by the decision model alone they would otherwise bury the real failures.
  const confirmed = ordered.filter((f) => findingKind(f) !== "unconfirmed");
  const leads = ordered.filter((f) => findingKind(f) === "unconfirmed");

  return (
    <li
      className={
        isOpen
          ? `border-l-2 ${VERDICT_RULE[evaluation.verdict]} bg-base-200/20`
          : "border-l-2 border-l-transparent"
      }
    >
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-base-200/40 transition-colors">
        <button
          type="button"
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          <span
            className={`badge badge-sm badge-soft shrink-0 sm:w-[8.5rem] justify-center ${VERDICT_STYLE[evaluation.verdict].className}`}
          >
            {VERDICT_STYLE[evaluation.verdict].label}
          </span>
          <span className="flex-1 min-w-0">
            <span
              className={`block truncate text-sm ${isSite ? "font-medium" : ""}`}
              title={isSite ? undefined : evaluation.pageUrl}
            >
              {isSite ? "Whole site" : displayUrl(evaluation.pageUrl)}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-base-content/55">
              {isSite ? (
                <span>Judged from the crawl inventory</span>
              ) : (
                evaluation.pageType && <span>{evaluation.pageType}</span>
              )}
              {evaluation.ymyl && (
                <span
                  className="badge badge-xs badge-soft badge-warning"
                  title="Your Money or Your Life topic: judged against a higher bar"
                >
                  YMYL
                </span>
              )}
              <span>{findingSummary(findings)}</span>
              {contentNotJudged && (
                <span className="badge badge-xs badge-ghost border-dashed">
                  Content not judged
                </span>
              )}
            </span>
          </span>
          <ChevronRight
            className={`size-4 shrink-0 text-base-content/40 transition-transform ${isOpen ? "rotate-90" : ""}`}
          />
        </button>
        {!isSite && (
          <a
            href={evaluation.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-xs btn-square shrink-0 text-base-content/40"
            aria-label="Open page"
            title="Open page"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      {isOpen && (
        <div className="pl-[11.25rem] pr-4 pb-4 pt-0.5 flex flex-col gap-4 max-md:pl-4">
          {evaluation.errorMessage && (
            <p className="text-sm text-error">
              {isSite ? "The site" : "This page"} could not be evaluated:{" "}
              {evaluation.errorMessage}
            </p>
          )}
          {contentNotJudged && (
            <p className="text-sm text-base-content/70 max-w-prose">
              The served HTML has almost no text (the page is probably rendered
              in the browser), so no content rule was put to a judge. The
              verdict covers the page data only.
            </p>
          )}
          {confirmed.length === 0 &&
            leads.length === 0 &&
            !evaluation.errorMessage &&
            !contentNotJudged && (
              <p className="text-sm text-base-content/70">
                {isSite
                  ? "Nothing to fix across the site."
                  : "Nothing to fix on this page."}
              </p>
            )}
          {confirmed.map((finding) => (
            <GuidelineFinding
              key={`${finding.evaluationId}-${finding.ruleId}`}
              finding={finding}
            />
          ))}
          {leads.length > 0 && (
            <details
              className="flex flex-col gap-3"
              open={confirmed.length === 0}
            >
              <summary className="cursor-pointer w-fit text-sm text-base-content/60 hover:text-base-content/80 select-none">
                {leads.length} unconfirmed lead{leads.length === 1 ? "" : "s"}{" "}
                <span className="text-xs text-base-content/45">
                  (flagged, but no judge quoted the page; they cannot block it)
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                {leads.map((finding) => (
                  <GuidelineFinding
                    key={`${finding.evaluationId}-${finding.ruleId}`}
                    finding={finding}
                  />
                ))}
              </div>
            </details>
          )}
          <UnansweredRules unanswered={unanswered} />
        </div>
      )}
    </li>
  );
}

/** The rules no one answered, grouped by why: coverage, not findings. */
function UnansweredRules({ unanswered }: { unanswered: GuidelineResultRow[] }) {
  if (unanswered.length === 0) return null;
  return (
    <details className="text-xs text-base-content/60">
      <summary className="cursor-pointer w-fit hover:text-base-content/80 select-none">
        {unanswered.length} rule{unanswered.length === 1 ? "" : "s"} not
        answered
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {unansweredByReason(unanswered).map(({ reason, ruleIds }) => (
          <li key={reason}>
            <p className="text-base-content/70">{reason}</p>
            <p className="text-base-content/50">
              {ruleIds.map((id) => RULES_BY_ID.get(id)?.name ?? id).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A URL without its scheme, which every row would otherwise repeat. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
