import { ExternalLink } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { RULES_BY_ID } from "@/shared/guidelines/catalog";
import type { GuidelineResultRow } from "./GuidelineEvaluationItem";
import {
  findingKind,
  parseClusterEvidence,
  type FindingKind,
} from "./guideline-view-model";

export const SEVERITY_DOT: Record<GuidelineResultRow["severity"], string> = {
  critical: "bg-destructive",
  high: "bg-warning",
  medium: "bg-muted-foreground/60",
  low: "bg-muted-foreground/30",
};

const KIND_STYLE: Record<
  FindingKind,
  { label: string; variant: "destructive" | "outline"; className?: string }
> = {
  site: { label: "Fails · site pattern", variant: "destructive" },
  fail: { label: "Fails", variant: "destructive" },
  unconfirmed: {
    label: "Unconfirmed",
    variant: "outline",
    className: "border-dashed text-muted-foreground",
  },
  // Outlined, so it does not read as the filled "Revise" verdict beside it.
  warning: {
    label: "Warning",
    variant: "outline",
    className: "border-warning text-warning-foreground dark:text-warning",
  },
};

const KIND_HINT: Partial<Record<FindingKind, string>> = {
  site: "This page is one of a cluster the site judge failed.",
  unconfirmed:
    "A lead, not a verdict: no judge quoted the page for it, so it cannot block the page.",
};

/**
 * The pipeline's own words for a downgraded failure. The kind badge and hint
 * already say it, so repeating it under every lead is noise.
 */
function isStandardDowngrade(reason: string): boolean {
  return /^(Flagged by the decision model; no second judge has confirmed it\.|Flagged by the judge without a quote from the page; confirm before acting\.)$/.test(
    reason,
  );
}

/** One rule the page (or site) did not pass: what, why, where, and the fix. */
export function GuidelineFinding({
  finding,
  compact = false,
}: {
  finding: GuidelineResultRow;
  /** In the by-rule view the rule, its fix and its source are the heading. */
  compact?: boolean;
}) {
  const rule = RULES_BY_ID.get(finding.ruleId);
  const kind = findingKind(finding);
  const { clusterIds, clusterLines, rest } = parseClusterEvidence(
    finding.evidence,
  );
  const quote = kind === "site" ? null : rest;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {!compact && (
          <>
            <span
              className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`}
              title={`${finding.severity} severity`}
            />
            <span className="text-sm font-medium">
              {rule?.name ?? finding.ruleId}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {finding.ruleId}
            </span>
          </>
        )}
        <Badge
          variant={KIND_STYLE[kind].variant}
          size="sm"
          className={KIND_STYLE[kind].className}
        >
          {KIND_STYLE[kind].label}
        </Badge>
        {!compact && (
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {finding.severity}
          </span>
        )}
      </div>

      {KIND_HINT[kind] && (
        <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
      )}
      {finding.reason && !isStandardDowngrade(finding.reason) && (
        <p className="text-sm text-foreground/80 max-w-prose">
          {finding.reason}
        </p>
      )}

      {clusterIds.length > 0 && (
        <ul className="flex flex-col gap-1 rounded border border-border bg-card px-3 py-2">
          {clusterLines.map((line) => (
            <li
              key={line}
              className="text-xs text-muted-foreground break-words"
            >
              {line}
            </li>
          ))}
        </ul>
      )}
      {kind === "site" && finding.evidence && (
        <p className="text-xs text-muted-foreground">{finding.evidence}</p>
      )}
      {quote && (
        <blockquote className="text-sm border-l-2 border-border pl-3 text-muted-foreground italic max-w-prose break-words">
          {quote}
        </blockquote>
      )}

      {!compact && finding.remediation && (
        <p className="text-sm max-w-prose">
          <span className="font-medium">How to fix: </span>
          <span className="text-foreground/80">{finding.remediation}</span>
        </p>
      )}

      {!compact && rule && <WhatGoogleSays ruleId={rule.id} />}
    </div>
  );
}

/** The rule's official quote and source, folded away until asked for. */
export function WhatGoogleSays({ ruleId }: { ruleId: string }) {
  const rule = RULES_BY_ID.get(ruleId);
  if (!rule || (!rule.official_quote && !rule.source_url)) return null;
  return (
    <details className="group text-xs max-w-prose">
      <summary className="cursor-pointer w-fit text-muted-foreground hover:text-foreground select-none">
        What Google says
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 border-l-2 border-primary/30 pl-3">
        {rule.official_quote && (
          <p className="text-muted-foreground">
            &ldquo;{rule.official_quote}&rdquo;
          </p>
        )}
        {rule.source_url && (
          <a
            href={rule.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 w-fit text-muted-foreground hover:text-foreground hover:underline"
          >
            Source
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </details>
  );
}
