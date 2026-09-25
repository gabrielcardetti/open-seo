import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { RULES_BY_ID } from "@/shared/guidelines/catalog";
import {
  GuidelineFinding,
  SEVERITY_DOT,
  WhatGoogleSays,
} from "./GuidelineFinding";
import { VERDICT_STYLE } from "./GuidelineEvaluationItem";
import type { RuleGroup } from "./guideline-view-model";

const MAX_RENDERED_PAGES = 50;

/**
 * Findings grouped by rule. A rule that fails on most pages is one fix for the
 * whole site (a template, a byline policy), which the per-page list hides.
 */
export function GuidelineRuleGroups({
  groups,
  pageCount,
}: {
  groups: RuleGroup[];
  pageCount: number;
}) {
  if (groups.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-base-content/60">
        No rule has findings on the pages shown.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-base-300/60">
      {groups.map((group) => (
        <RuleRow key={group.ruleId} group={group} pageCount={pageCount} />
      ))}
    </ul>
  );
}

function RuleRow({
  group,
  pageCount,
}: {
  group: RuleGroup;
  pageCount: number;
}) {
  const [open, setOpen] = useState(false);
  const rule = RULES_BY_ID.get(group.ruleId);
  const affected = group.fails + group.warnings;
  const share = pageCount > 0 ? Math.min(1, affected / pageCount) : 0;
  const shown = group.entries.slice(0, MAX_RENDERED_PAGES);

  return (
    <li
      className={
        open
          ? "border-l-2 border-l-base-content/20 bg-base-200/20"
          : "border-l-2 border-l-transparent"
      }
    >
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-base-200/40 transition-colors"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT[group.severity]}`}
          title={`${group.severity} severity`}
        />
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{group.name}</span>
            <span className="font-mono text-[11px] text-base-content/40 shrink-0">
              {group.ruleId}
            </span>
          </span>
          <span className="block text-xs text-base-content/55">
            {group.fails > 0 && `${group.fails} failing`}
            {group.fails > 0 && group.warnings > 0 && " · "}
            {group.warnings > 0 && `${group.warnings} flagged`}
          </span>
        </span>
        <span
          className="hidden sm:flex items-center gap-2 shrink-0"
          title={`${affected} of ${pageCount} pages`}
        >
          <span className="h-1.5 w-24 rounded-full bg-base-300 overflow-hidden">
            <span
              className={`block h-full ${group.fails > 0 ? "bg-error/70" : "bg-base-content/30"}`}
              style={{ width: `${Math.max(4, share * 100)}%` }}
            />
          </span>
          <span className="text-xs tabular-nums text-base-content/50 w-14 text-right">
            {affected}/{pageCount}
          </span>
        </span>
        <ChevronRight
          className={`size-4 shrink-0 text-base-content/40 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="pl-9 pr-4 pb-4 pt-0.5 flex flex-col gap-3">
          {rule?.question && (
            <p className="text-sm text-base-content/70 max-w-prose">
              {rule.question}
            </p>
          )}
          {rule?.remediation && (
            <p className="text-sm max-w-prose">
              <span className="font-medium">How to fix: </span>
              <span className="text-base-content/80">{rule.remediation}</span>
            </p>
          )}
          <WhatGoogleSays ruleId={group.ruleId} />
          <ul className="max-h-[480px] overflow-y-auto rounded border border-base-300/60 bg-base-100 divide-y divide-base-300/50">
            {shown.map(({ evaluation, finding }) => (
              <li
                key={`${evaluation.id}-${finding.ruleId}`}
                className="px-3 py-2 flex flex-col gap-1.5"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`badge badge-xs shrink-0 ${VERDICT_STYLE[evaluation.verdict].className}`}
                  >
                    {VERDICT_STYLE[evaluation.verdict].label}
                  </span>
                  {evaluation.pageType === "site" ? (
                    <span className="text-sm font-medium">Whole site</span>
                  ) : (
                    <a
                      className="link link-hover text-sm text-base-content/80 truncate"
                      href={evaluation.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={evaluation.pageUrl}
                    >
                      {evaluation.pageUrl.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </span>
                <GuidelineFinding finding={finding} compact />
              </li>
            ))}
            {group.entries.length > shown.length && (
              <li className="px-3 py-2 text-xs text-base-content/50">
                …and {group.entries.length - shown.length} more pages.
              </li>
            )}
          </ul>
        </div>
      )}
    </li>
  );
}
