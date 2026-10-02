/**
 * What the guideline tab derives from stored rows before rendering: which
 * judge answered, how a finding should be labelled, and the same findings
 * grouped by rule instead of by page.
 *
 * Pure, so the rules that decide what a user reads ("is this a confirmed
 * failure or a lead to check?") are tested without rendering anything.
 */
import { sort } from "remeda";
import { RULES_BY_ID, type Verdict } from "@/shared/guidelines/catalog";
import { conflictNote } from "@/shared/guidelines/engine-verdicts";
import type {
  GuidelineEvaluationRow,
  GuidelineResultRow,
} from "./GuidelineEvaluationItem";

export const VERDICT_ORDER: Verdict[] = [
  "reject",
  "revise",
  "pass_with_warnings",
  "pass",
];

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * Whether a judge label names only the decision model. Its failures can never
 * block a page (it cannot quote one), so a whole evaluation judged by it alone
 * says less than its verdicts suggest, and the tab says so.
 */
export function isDecisionOnly(judge: string | null): boolean {
  if (!judge) return false;
  const parts = judge.split("+");
  return parts.every((part) => /jev/i.test(part));
}

/** The judges an evaluation used, for the summary line. */
export function judgeLabel(judge: string | null): string {
  if (!judge || judge === "deterministic") return "page data only";
  return judge
    .split("+")
    .map((part) =>
      /jev/i.test(part)
        ? "decision model (Jev)"
        : part.startsWith("mcp:")
          ? `${part.slice(4)} via MCP`
          : part === "mcp"
            ? "external agent via MCP"
            : part,
    )
    .join(" + ");
}

/**
 * How a finding reads to a person.
 *
 * - `site`: a page failure that comes from the site pass, because the page is
 *   one of a cluster the site judge failed (its evidence names the cluster).
 * - `fail`: a failure the judge quoted from the page.
 * - `unconfirmed`: a failure no second judge confirmed, or whose quote is not
 *   on the page. It cannot block the page; it is a lead to check.
 * - `conflict`: a rule that is one engine's preference against another's
 *   (Bing prefers it, Google says it is not needed). Information, never a
 *   failure.
 * - `warning`: everything else that did not pass.
 */
export type FindingKind =
  | "site"
  | "fail"
  | "unconfirmed"
  | "conflict"
  | "warning";

const UNCONFIRMED_REASON =
  /no second judge has confirmed|without a quote from the page|quote is not on the page|not confirmed/i;

export function findingKind(finding: GuidelineResultRow): FindingKind {
  if (conflictNote(finding.ruleId)) return "conflict";
  if (finding.status === "fail") {
    return finding.evidence?.startsWith("One of the pages in cluster")
      ? "site"
      : "fail";
  }
  return UNCONFIRMED_REASON.test(finding.reason ?? "")
    ? "unconfirmed"
    : "warning";
}

/**
 * A site finding's evidence as stored: an anchored `[clusters: C1, C3]`
 * prefix, the cited clusters' descriptions separated by "; ", then the judge's
 * own evidence after " — ". Split so the clusters render as a list.
 */
export function parseClusterEvidence(evidence: string | null): {
  clusterIds: string[];
  clusterLines: string[];
  rest: string | null;
} {
  const match = evidence?.match(/^\[clusters: ([^\]]*)\]\s*/);
  if (!evidence || !match) {
    return { clusterIds: [], clusterLines: [], rest: evidence };
  }
  const clusterIds = match[1]
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const body = evidence.slice(match[0].length);
  const [described, ...restParts] = body.split(" — ");
  return {
    clusterIds,
    clusterLines: described
      .split(/;\s+(?=C\d+:)/)
      .map((line) => line.trim())
      .filter(Boolean),
    rest: restParts.join(" — ").trim() || null,
  };
}

export interface RuleGroup {
  ruleId: string;
  name: string;
  severity: GuidelineResultRow["severity"];
  fails: number;
  warnings: number;
  entries: Array<{
    evaluation: GuidelineEvaluationRow;
    finding: GuidelineResultRow;
  }>;
}

/**
 * The same findings, one group per rule: a rule that fails on 29 of 30 pages
 * is a site problem to fix once, not 29 page problems. Most severe first, then
 * by how many pages it fails.
 */
export function groupByRule(
  evaluations: readonly GuidelineEvaluationRow[],
  results: readonly GuidelineResultRow[],
): RuleGroup[] {
  const byId = new Map(evaluations.map((row) => [row.id, row]));
  const groups = new Map<string, RuleGroup>();
  for (const finding of results) {
    if (finding.status === "unknown") continue;
    const evaluation = byId.get(finding.evaluationId);
    if (!evaluation) continue;
    let group = groups.get(finding.ruleId);
    if (!group) {
      group = {
        ruleId: finding.ruleId,
        name: RULES_BY_ID.get(finding.ruleId)?.name ?? finding.ruleId,
        severity: finding.severity,
        fails: 0,
        warnings: 0,
        entries: [],
      };
      groups.set(finding.ruleId, group);
    }
    // A pattern rule caps at high on a page; the group shows its worst.
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[group.severity]) {
      group.severity = finding.severity;
    }
    if (finding.status === "fail" && findingKind(finding) !== "conflict") {
      group.fails += 1;
    } else group.warnings += 1;
    group.entries.push({ evaluation, finding });
  }
  return sort(
    [...groups.values()],
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.fails - a.fails ||
      b.warnings - a.warnings ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

/** Unanswered rules of one evaluation, grouped by why nobody answered them. */
export function unansweredByReason(
  results: readonly GuidelineResultRow[],
): Array<{ reason: string; ruleIds: string[] }> {
  const byReason = new Map<string, string[]>();
  for (const result of results) {
    if (result.status !== "unknown") continue;
    const reason = result.reason ?? "No reason recorded.";
    const ids = byReason.get(reason);
    if (ids) ids.push(result.ruleId);
    else byReason.set(reason, [result.ruleId]);
  }
  return sort(
    [...byReason.entries()].map(([reason, ruleIds]) => ({ reason, ruleIds })),
    (a, b) => b.ruleIds.length - a.ruleIds.length,
  );
}
