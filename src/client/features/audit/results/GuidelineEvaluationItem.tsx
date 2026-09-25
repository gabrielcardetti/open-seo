import { ChevronDown, ExternalLink } from "lucide-react";
import { RULES_BY_ID, type Verdict } from "@/shared/guidelines/catalog";

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
  { label: string; className: string }
> = {
  reject: { label: "Reject", className: "badge-error" },
  revise: { label: "Revise", className: "badge-warning" },
  pass_with_warnings: { label: "Pass with warnings", className: "badge-ghost" },
  pass: { label: "Pass", className: "badge-success" },
};

const SEVERITY_STYLE: Record<GuidelineResultRow["severity"], string> = {
  critical: "text-error",
  high: "text-warning",
  medium: "text-base-content/70",
  low: "text-base-content/50",
};

/**
 * One evaluated page, or the whole site, as a row that opens onto its
 * findings. The site row's URL is a sentinel (`<origin>/#site`), never shown
 * or linked: it is labelled instead.
 */
export function GuidelineEvaluationItem({
  evaluation,
  findings,
  isOpen,
  onToggle,
}: {
  evaluation: GuidelineEvaluationRow;
  findings: GuidelineResultRow[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isSite = evaluation.pageType === "site";
  return (
    <li className="py-2">
      <button
        type="button"
        className="flex items-start gap-3 w-full text-left"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <ChevronDown
          className={`w-4 h-4 mt-1 flex-none transition-transform ${isOpen ? "" : "-rotate-90"}`}
        />
        <span
          className={`badge badge-sm flex-none ${VERDICT_STYLE[evaluation.verdict].className}`}
        >
          {VERDICT_STYLE[evaluation.verdict].label}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className={`block truncate text-sm ${isSite ? "font-medium" : ""}`}
          >
            {isSite ? "Whole site" : evaluation.pageUrl}
          </span>
          <span className="block text-xs text-base-content/60">
            {isSite ? "Judged from the crawl inventory · " : ""}
            {findings.length} finding{findings.length === 1 ? "" : "s"}
            {evaluation.ymyl ? " · YMYL" : ""}
            {evaluation.unknownCount > 0
              ? ` · ${evaluation.unknownCount} rule${evaluation.unknownCount === 1 ? "" : "s"} unanswered`
              : ""}
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="pl-11 pr-2 pb-2 flex flex-col gap-3">
          {evaluation.errorMessage && (
            <p className="text-sm text-error">
              {isSite ? "The site" : "This page"} could not be evaluated:{" "}
              {evaluation.errorMessage}
            </p>
          )}
          {findings.length === 0 && !evaluation.errorMessage && (
            <p className="text-sm text-base-content/70">
              {isSite
                ? "Nothing to fix across the site."
                : "Nothing to fix on this page."}
            </p>
          )}
          {findings.map((finding) => {
            const rule = RULES_BY_ID.get(finding.ruleId);
            return (
              <div
                key={`${finding.evaluationId}-${finding.ruleId}`}
                className="flex flex-col gap-1"
              >
                <p className="text-sm font-medium">
                  <span className={SEVERITY_STYLE[finding.severity]}>
                    {finding.severity}
                  </span>{" "}
                  · {rule?.name ?? finding.ruleId}
                  {finding.status === "warn" && (
                    <span className="text-base-content/50"> (warning)</span>
                  )}
                </p>
                {finding.reason && (
                  <p className="text-sm text-base-content/80">
                    {finding.reason}
                  </p>
                )}
                {finding.evidence && (
                  <blockquote className="text-sm border-l-2 border-base-300 pl-3 text-base-content/70 italic">
                    {finding.evidence}
                  </blockquote>
                )}
                {finding.remediation && (
                  <p className="text-sm">
                    <span className="font-medium">Fix: </span>
                    {finding.remediation}
                  </p>
                )}
                {rule?.source_url && (
                  <a
                    href={rule.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="link link-hover text-xs inline-flex items-center gap-1 w-fit"
                  >
                    Google&rsquo;s guidance on this
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}
