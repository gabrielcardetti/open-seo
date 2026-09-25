/**
 * Evaluates the site as a whole: the rules no single page can answer.
 *
 * It mirrors `evaluatePage` — deterministic first, then a judge on what is
 * left, then `unknown` for whatever nobody answered — but the input is the
 * crawl inventory (`SiteFacts`) instead of a page, and the result is stored as
 * one more evaluation row under the sentinel URL `facts.sentinelUrl`, with page
 * type "site".
 *
 * Three things differ from a page on purpose:
 *
 * - Only the language model judges it. The decision model has no calibration
 *   on inventory text, and the site's URLs and titles are not sent to it.
 * - The judge sees URLs and titles, never text, so a doorway or scaled-content
 *   failure must be corroborated by the shape of the cluster it cites (see
 *   `corroborated`) or it is kept as a warning.
 * - A judge failure never throws: the deterministic answers are still worth a
 *   row, and the page waves still run without a site view.
 */
import {
  RULES_BY_ID,
  rulesForContext,
  type GuidelineRule,
  type RuleStatus,
} from "@/shared/guidelines/catalog";
import {
  SITE_PATTERN_RULES,
  SITE_ROW_ONLY_RULES,
  siteJudgeableRules,
  unjudgeableReason,
} from "@/shared/guidelines/judge-map";
import { detectUrlTemplate } from "../audit/url-utils";
import {
  withoutUngroundedSiteFails,
  type JudgedRule,
  type RuleJudge,
} from "./judge";
import type { PageClassification } from "./page-classifier";
import {
  summarizeEvaluation,
  type EvaluatedRule,
  type PageEvaluation,
} from "./page-evaluator";
import { evaluateDeterministic } from "./rule-evaluators";
import type { SiteContext, SiteRuleAnswer } from "./site-combine";
import {
  CLUSTER_MIN_SIZE,
  clusterMembership,
  type SiteFacts,
} from "./site-facts";

const SITE_CLASSIFICATION: PageClassification = {
  pageType: "site",
  ymyl: false,
  ymylTopics: [],
  isReview: false,
  hasSchema: false,
  aiSuspected: false,
};

/**
 * Site failures that need the cited cluster to look stamped out: identical
 * text, or word counts within a few dozen words of each other. A real catalog
 * shares a template and a title pattern too, but its pages' own content
 * varies by hundreds of words. The spread is the only length signal that
 * holds: crawl word counts include the navigation and footer, so the
 * coefficient of variation and the median are dominated by boilerplate
 * (legitimate catalogs measure cv 0.01-0.09).
 */
const CORROBORATED_RULES = new Set(["SPAM-02", "AI-04", "SPAM-11"]);
const MAX_STAMPED_WORD_SPREAD = 40;

/** Settled from the page results, in `finalizeSite`. */
const AUTHORS_RULE = "SITE-04";
/** Page types where a reader asks who wrote it. */
const BYLINED_PAGE_TYPES = new Set(["article", "review"]);

/**
 * The site-scope rules plus the `both` rules that ask about a pattern. No
 * site precondition input is known here, so `{}` keeps the gated rules
 * (SITE-06 on Search Console) out, as on pages.
 */
function siteRules(): GuidelineRule[] {
  return rulesForContext({}, "site").filter(
    (rule) => rule.scope === "site" || SITE_PATTERN_RULES.has(rule.id),
  );
}

function corroborated(result: JudgedRule, facts: SiteFacts): JudgedRule {
  if (result.status !== "fail" || !CORROBORATED_RULES.has(result.ruleId)) {
    return result;
  }
  const stampedOut = facts.clusters.some(
    (cluster) =>
      result.clusters?.includes(cluster.id) &&
      cluster.size >= CLUSTER_MIN_SIZE &&
      (cluster.kind === "exact_body" ||
        cluster.wordRange[1] - cluster.wordRange[0] <= MAX_STAMPED_WORD_SPREAD),
  );
  if (stampedOut) return result;
  return {
    ...result,
    status: "warn",
    reason:
      `Flagged from URLs and titles, not confirmed: no cited cluster has identical text or near-identical word counts. ${result.reason ?? ""}`.trim(),
  };
}

/**
 * The cited clusters described in the evidence, so the stored finding reads
 * on its own and a later reader (the MCP path, from the database) can recover
 * which clusters it rests on. The ids go in an anchored `[clusters: …]` prefix
 * that `citedClusters` parses; ids anywhere else in the text ("Inglés C1", "C2
 * is a course catalog") must not count as citations.
 */
function withClusterEvidence(result: JudgedRule, facts: SiteFacts): JudgedRule {
  const described = facts.clusters
    .filter((cluster) => result.clusters?.includes(cluster.id))
    .map(
      (cluster) =>
        `${cluster.id}: ${cluster.size} pages ${cluster.template} "${cluster.key}", words ${cluster.wordRange[0]}–${cluster.wordRange[1]}`,
    );
  if (described.length === 0) return result;
  const ids = facts.clusters
    .filter((cluster) => result.clusters?.includes(cluster.id))
    .map((cluster) => cluster.id);
  return {
    ...result,
    evidence: [
      `[clusters: ${ids.join(", ")}] ${described.join("; ")}`,
      result.evidence,
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 1000),
  };
}

const unanswered = (ruleId: string, reason: string): JudgedRule => ({
  ruleId,
  status: "unknown",
  confidence: null,
  evidence: null,
  reason,
});

export async function evaluateSite({
  facts,
  businessOverview,
  languageJudge,
}: {
  facts: SiteFacts;
  businessOverview?: string | null;
  /** The only site judge; without one the judged rules stay unknown. */
  languageJudge?: RuleJudge | null;
}): Promise<PageEvaluation> {
  const applicable = siteRules();
  const settled = new Map<string, JudgedRule>();

  // 1. What the inventory proves outright.
  for (const rule of applicable) {
    const result = evaluateDeterministic(rule.id, { site: { facts } });
    if (!result) continue;
    settled.set(rule.id, {
      ruleId: rule.id,
      status: result.status,
      confidence: null,
      evidence: result.evidence ?? null,
      reason: result.reason ?? null,
    });
  }
  // An author template (/autor/:slug) is authorship on its face; without one,
  // `finalizeSite` reads it from the pages' bylines.
  const authors = facts.trust.authorTemplate;
  if (authors && applicable.some((rule) => rule.id === AUTHORS_RULE)) {
    settled.set(AUTHORS_RULE, {
      ruleId: AUTHORS_RULE,
      status: "pass",
      evidence: `${authors.template} (${authors.count} pages)`,
    });
  }

  // 2. What no judge will be asked.
  const remaining = applicable.filter((rule) => !settled.has(rule.id));
  const askable = siteJudgeableRules(remaining);
  const askableIds = new Set(askable.map((rule) => rule.id));
  for (const rule of remaining) {
    if (askableIds.has(rule.id)) continue;
    settled.set(
      rule.id,
      unanswered(
        rule.id,
        unjudgeableReason(rule) ?? "No evaluator for this rule.",
      ),
    );
  }

  // 3. One language-model call over the inventory.
  const known = new Set(facts.clusters.map((cluster) => cluster.id));
  let judgeName: string | null = null;
  if (languageJudge && askable.length > 0) {
    try {
      const judged = await languageJudge.judge({
        kind: "site",
        site: facts,
        rules: askable,
        businessOverview,
      });
      judgeName = languageJudge.modelId;
      for (const result of judged) {
        if (!askableIds.has(result.ruleId)) continue;
        const checked = corroborated(
          withoutUngroundedSiteFails(result, facts),
          facts,
        );
        // A cluster the facts never had points at no page.
        const clusters = checked.clusters?.filter((id) => known.has(id));
        settled.set(
          result.ruleId,
          withClusterEvidence({ ...checked, clusters }, facts),
        );
      }
    } catch (error) {
      console.warn(
        `Guideline site judge failed for ${facts.origin}; keeping deterministic answers`,
        error,
      );
    }
  }
  const noAnswer = languageJudge
    ? "No judge answered this rule."
    : "The site pass needs a language model, and none is configured.";
  for (const rule of askable) {
    if (!settled.has(rule.id)) {
      settled.set(rule.id, unanswered(rule.id, noAnswer));
    }
  }

  return summarizeEvaluation({
    page: { finalUrl: facts.sentinelUrl },
    classification: SITE_CLASSIFICATION,
    applicable,
    outcomes: Array.from(settled.values()),
    judge: judgeName ?? "deterministic",
    level: "site",
  });
}

/** One evaluated page, as `finalizeSite` needs it. */
export interface SitePageResult {
  pageType: string;
  /** WHO-01's status on the page (a pass when it has no finding); null when not asked. */
  who01Status: RuleStatus | null;
}

const toJudged = (finding: EvaluatedRule): JudgedRule => ({
  ruleId: finding.ruleId,
  status: finding.status,
  score: finding.score,
  confidence: finding.confidence,
  evidence: finding.evidence,
  reason: finding.reason,
  clusters: finding.clusters,
});

/**
 * Settles SITE-04 from the evaluated pages and recomputes the verdict.
 *
 * "Real authors where a reader expects them" depends on which pages call for
 * one, and that is what the page pass decided: an article or review whose
 * WHO-01 passed names its author. Half of them doing so passes; none of at
 * least three warns (the rule is low severity, and a sample is a sample);
 * anything in between stays unknown.
 */
export function finalizeSite(
  evaluation: PageEvaluation,
  pageResults: readonly SitePageResult[],
): PageEvaluation {
  const current = evaluation.findings.find(
    (finding) => finding.ruleId === AUTHORS_RULE,
  );
  if (current?.status !== "unknown") return evaluation;

  const bylineExpected = pageResults.filter(
    (page) =>
      BYLINED_PAGE_TYPES.has(page.pageType) && page.who01Status !== null,
  );
  const bylined = bylineExpected.filter(
    (page) => page.who01Status === "pass",
  ).length;
  const summary = `${bylined} of ${bylineExpected.length} evaluated articles and reviews name an author`;
  let authors: JudgedRule;
  if (bylineExpected.length > 0 && bylined / bylineExpected.length >= 0.5) {
    authors = { ruleId: AUTHORS_RULE, status: "pass", evidence: summary };
  } else if (bylineExpected.length >= 3 && bylined === 0) {
    authors = {
      ruleId: AUTHORS_RULE,
      status: "warn",
      evidence: summary,
      reason:
        "None of the sampled articles or reviews says who wrote it, where a reader would ask.",
    };
  } else {
    return evaluation;
  }

  return summarizeEvaluation({
    page: { finalUrl: evaluation.url },
    classification: evaluation.classification,
    applicable: evaluation.applicableRuleIds.flatMap((id) => {
      const rule = RULES_BY_ID.get(id);
      return rule ? [rule] : [];
    }),
    outcomes: [
      ...evaluation.findings
        .filter((finding) => finding.ruleId !== AUTHORS_RULE)
        .map(toJudged),
      authors,
    ],
    judge: evaluation.judge,
    level: "site",
  });
}

/**
 * The clusters a stored site finding rests on: its own list, or the ids its
 * evidence names (see `withClusterEvidence`) when read back from the
 * database. Only ids the current facts have: any other names no page.
 */
function citedClusters(finding: EvaluatedRule, facts: SiteFacts): string[] {
  const ids = facts.clusters.map((cluster) => cluster.id);
  if (finding.clusters) {
    return finding.clusters.filter((id) => ids.includes(id));
  }
  const prefix = (finding.evidence ?? "").match(/^\[clusters: ([^\]]*)\]/);
  const named = prefix ? prefix[1].split(",").map((id) => id.trim()) : [];
  return ids.filter((id) => named.includes(id));
}

/** Pages of each flagged cluster the page waves should judge, at most. */
const FLAGGED_CLUSTER_PAGES = 2;

/**
 * Pages of the clusters the site pass flagged that the sample left out.
 *
 * The sampler takes each URL template's longest pages, and doorway pages are
 * short by nature: when they share `/:slug` with real articles, none of them
 * is judged, and the site's finding reaches no page. A couple per flagged
 * cluster fixes that without turning the sample into the cluster.
 */
export function flaggedClusterPages(
  facts: SiteFacts,
  siteEvaluation: PageEvaluation,
  sampledUrls: readonly string[],
): string[] {
  const sampled = new Set(sampledUrls);
  const wanted = new Set<string>();
  for (const finding of siteEvaluation.findings) {
    if (
      !SITE_PATTERN_RULES.has(finding.ruleId) ||
      SITE_ROW_ONLY_RULES.has(finding.ruleId) ||
      (finding.status !== "fail" && finding.status !== "warn")
    ) {
      continue;
    }
    const cited = citedClusters(finding, facts);
    for (const cluster of facts.clusters) {
      if (!cited.includes(cluster.id)) continue;
      cluster.memberUrls
        .filter((url) => !sampled.has(url))
        .slice(0, FLAGGED_CLUSTER_PAGES)
        .forEach((url) => wanted.add(url));
    }
  }
  return [...wanted];
}

function siteAnswer(finding: EvaluatedRule, facts: SiteFacts): SiteRuleAnswer {
  const clusters = citedClusters(finding, facts);
  return {
    status: finding.status,
    clusters,
    identicalText: facts.clusters.some(
      (cluster) =>
        clusters.includes(cluster.id) && cluster.kind === "exact_body",
    ),
    evidence: finding.evidence,
    reason: finding.reason,
  };
}

/**
 * What one page's evaluation needs from the site pass: the pattern-rule
 * answers, and the page's clusters and template. `url` is the crawled URL, the
 * one the clusters list as members.
 */
export function siteContextFor(
  facts: SiteFacts,
  siteEvaluation: PageEvaluation,
  url: string,
): SiteContext {
  const answers: Record<string, SiteRuleAnswer> = {};
  for (const ruleId of siteEvaluation.applicableRuleIds) {
    if (!SITE_PATTERN_RULES.has(ruleId)) continue;
    const finding = siteEvaluation.findings.find((f) => f.ruleId === ruleId);
    answers[ruleId] = finding
      ? siteAnswer(finding, facts)
      : {
          status: "pass",
          clusters: [],
          identicalText: false,
          evidence: null,
          reason: null,
        };
  }

  let template: string | null = null;
  try {
    template = detectUrlTemplate(new URL(url).pathname);
  } catch {
    // An unparseable URL has no template; the page is then no one's sibling.
  }
  return {
    answers,
    memberOf: clusterMembership(facts, url),
    template,
    templateSize:
      facts.templates.find((group) => group.template === template)?.count ?? 0,
  };
}
