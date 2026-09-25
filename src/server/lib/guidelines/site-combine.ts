/**
 * Combining a page's own answer to a pattern rule with the site pass's.
 *
 * A doorway page read alone looks ordinary; the site pass sees its 214
 * siblings. So for the pattern rules (`SITE_PATTERN_RULES`) the page verdict
 * takes both into account, at page-evaluation time, which keeps page rows
 * write-once.
 *
 * Only a site fail or warn that cites clusters reaches a page, and only a page
 * in one of those clusters:
 *
 * - fail: the page fails too, confirmed at site level, so a critical pattern
 *   rule rejects it. Outside the cluster the page keeps its own answer: one
 *   bad section must not smear the whole site.
 * - warn: the page gets at least a warning.
 *
 * Everything else leaves the page's answer alone. A site pass never clears a
 * page: a set of three to seven doorways is below `CLUSTER_MIN_SIZE`, so the
 * inventory cannot show it and the page judge's failure has to stand. And the
 * topic-scatter rules (`SITE_ROW_ONLY_RULES`) stay on the site row, since they
 * describe no template a page could belong to.
 */
import type { RuleStatus } from "@/shared/guidelines/catalog";
import {
  SITE_PATTERN_RULES,
  SITE_ROW_ONLY_RULES,
} from "@/shared/guidelines/judge-map";
import type { JudgedRule, PageTemplateNote } from "./judge";

/** The site pass's answer to one pattern rule, as a page sees it. */
export interface SiteRuleAnswer {
  status: RuleStatus;
  /** Cluster ids (C1..) the site finding rests on; empty when it cites none. */
  clusters: string[];
  /**
   * A cited cluster's pages have identical text. Only then can the site's
   * answer reject a member page: near-identical word counts alone also fit
   * product variants and fixed-size listings, where a wrong model call would
   * otherwise reject every page of a legitimate catalog.
   */
  identicalText: boolean;
  evidence: string | null;
  reason: string | null;
}

/** What a page evaluation needs from the site pass. */
export interface SiteContext extends PageTemplateNote {
  /** Keyed by rule id; only the pattern rules the site pass answered. */
  answers: Record<string, SiteRuleAnswer>;
  /** Clusters this page belongs to. */
  memberOf: string[];
  /** `detectUrlTemplate` of the page's path. */
  template: string | null;
  /** Crawled pages sharing that template; 0 when it is not among the top ones. */
  templateSize: number;
}

/**
 * The clusters through which a site answer reaches this page: the cited ones
 * the page belongs to, when the answer is a fail or warn on a rule that
 * propagates at all. Empty means the page keeps its own answer.
 */
export function clustersReachingPage(
  ruleId: string,
  site: { status: RuleStatus; clusters: readonly string[] },
  memberOf: readonly string[],
): string[] {
  if (SITE_ROW_ONLY_RULES.has(ruleId)) return [];
  if (site.status !== "fail" && site.status !== "warn") return [];
  return site.clusters.filter((id) => memberOf.includes(id));
}

/** The site finding restated for one of the pages it covers. */
function memberEvidence(clusters: string[], site: SiteRuleAnswer): string {
  return [`One of the pages in cluster ${clusters.join(", ")}.`, site.evidence]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);
}

export function combineWithSite(
  pageRule: JudgedRule,
  site: SiteRuleAnswer | undefined,
  memberOf: readonly string[],
): JudgedRule {
  if (!site) return pageRule;
  const clusters = clustersReachingPage(pageRule.ruleId, site, memberOf);
  if (clusters.length === 0) return pageRule;

  if (site.status === "fail") {
    return {
      ...pageRule,
      status: "fail",
      // Without identical text the page answer caps at high (revise), as any
      // page-level answer to a pattern rule does; the site row still rejects.
      level: site.identicalText ? "site" : "page",
      clusters,
      evidence: memberEvidence(clusters, site),
      reason: site.reason ?? pageRule.reason ?? null,
    };
  }
  if (pageRule.status === "fail" || pageRule.status === "warn") {
    return pageRule;
  }
  return {
    ...pageRule,
    status: "warn",
    clusters,
    evidence: memberEvidence(clusters, site),
    reason:
      site.reason ??
      "The site pass flagged the pattern this page belongs to; confirm it.",
  };
}

/** `combineWithSite` over a page's outcomes; unchanged without a site pass. */
export function applySiteContext(
  outcomes: readonly JudgedRule[],
  context: SiteContext | null | undefined,
): JudgedRule[] {
  if (!context) return [...outcomes];
  return outcomes.map((outcome) =>
    SITE_PATTERN_RULES.has(outcome.ruleId)
      ? combineWithSite(
          outcome,
          context.answers[outcome.ruleId],
          context.memberOf,
        )
      : outcome,
  );
}
