/**
 * The judging contract.
 *
 * A judge answers guideline rules about one page. There are three kinds and
 * they are genuinely different instruments, not interchangeable backends:
 *
 * - a decision model (Jev on Workers AI) answers every rule at once, in
 *   milliseconds, with a calibrated confidence — but cannot write a sentence;
 * - a language model writes the evidence and reasoning a finding needs to be
 *   actionable, and costs output tokens to do it;
 * - an external agent (the MCP client's own model) does the same work on
 *   someone else's subscription.
 *
 * So the pipeline uses them together: the decision model judges everything
 * cheaply, and the language model is spent only on what the first one flagged
 * or was unsure about.
 */
import type { GuidelineRule, RuleStatus } from "@/shared/guidelines/catalog";
import type { FetchedPage } from "./page-fetch";
import { clustersReachingPage } from "./site-combine";
import type { PatternCluster, SiteExample, SiteFacts } from "./site-facts";

export type JudgeName = "jev" | "llm" | "mcp";

export interface JudgedRule {
  ruleId: string;
  status: RuleStatus;
  /** 1-5 for graded rules. */
  score?: number | null;
  /** The judge's certainty, where it reports one. */
  confidence?: number | null;
  /** Short quote from the page. Decision models cannot produce this. */
  evidence?: string | null;
  reason?: string | null;
  /** Site findings: the pattern clusters (C1..) the judge cites. */
  clusters?: string[] | null;
  /**
   * "site" when the site pass confirmed this answer (the page belongs to a
   * cluster the site judge failed), so it weighs as a site-level finding.
   */
  level?: "page" | "site";
}

interface JudgeRequest {
  rules: readonly GuidelineRule[];
  /** Business context, so "who is this for?" is answerable. */
  businessOverview?: string | null;
}

/** Where a page sits in the site's URL inventory, from the site pass. */
export interface PageTemplateNote {
  template: string | null;
  templateSize: number;
  memberOf: readonly string[];
  /** The site pass's answers to the pattern rules, by rule id. */
  answers: Readonly<
    Record<string, { status: RuleStatus; clusters: readonly string[] }>
  >;
}

/**
 * The TEMPLATE line, only when the site pass flagged a cluster this page is
 * in. On a legitimate catalog the template alone would read as a hint that
 * the page is one of many and prime a scaled-content failure.
 */
function templateLine(note: PageTemplateNote): string | null {
  const flagged = Object.entries(note.answers).flatMap(([ruleId, answer]) => {
    const clusters = clustersReachingPage(ruleId, answer, note.memberOf);
    return clusters.length
      ? [
          `site-level ${ruleId}: ${answer.status} on cluster ${clusters.join(", ")}`,
        ]
      : [];
  });
  if (flagged.length === 0) return null;
  const shape = note.template
    ? `${note.template} (${note.templateSize} pages)`
    : "no shared URL template";
  return `TEMPLATE: ${shape}; ${flagged.join("; ")}`;
}

interface PageJudgeInput extends JudgeRequest {
  kind?: "page";
  page: FetchedPage;
  template?: PageTemplateNote | null;
}

/** The whole site, judged from its crawl inventory instead of a page. */
interface SiteJudgeInput extends JudgeRequest {
  kind: "site";
  site: SiteFacts;
}

export type JudgeInput = PageJudgeInput | SiteJudgeInput;

export interface RuleJudge {
  readonly name: JudgeName;
  /** Model identifier recorded alongside the verdict, for attribution. */
  readonly modelId: string;
  judge(input: JudgeInput): Promise<JudgedRule[]>;
}

/** Characters of main content handed to a judge. */
const MAX_JUDGE_CONTENT_CHARS = 12_000;

/**
 * The page as a judge sees it.
 *
 * Deliberately flat text rather than JSON: these are questions about what a
 * reader encounters, and a reader does not encounter field names. The metadata
 * is included because several rules are about the gap between what a page
 * promises in its title and what it delivers in its body.
 */
export function renderPageState(
  page: FetchedPage,
  businessOverview?: string | null,
  template?: PageTemplateNote | null,
): string {
  const lines = [`URL: ${page.finalUrl}`];
  // The one site fact a page judge gets: that the site pass flagged the
  // pattern this page is part of, which one page cannot show.
  const flagged = template ? templateLine(template) : null;
  if (flagged) lines.push(flagged);
  lines.push(
    `TITLE: ${page.title || "(none)"}`,
    `META DESCRIPTION: ${page.metaDescription || "(none)"}`,
    `H1: ${page.h1s.join(" | ") || "(none)"}`,
    `WORD COUNT: ${page.wordCount}`,
    `IMAGES: ${page.imagesTotal} (${page.imagesMissingAlt} without alt text)`,
    `LINKS: ${page.internalLinks} internal, ${page.externalLinks} external`,
  );
  if (page.structuredData.length > 0) {
    lines.push(
      `STRUCTURED DATA: ${JSON.stringify(page.structuredData).slice(0, 1500)}`,
    );
  }
  if (businessOverview?.trim()) {
    lines.push(`SITE CONTEXT: ${businessOverview.trim().slice(0, 800)}`);
  }
  // Scam facts (SPAM-17). A password form's target is not in the text the
  // judge reads, and the rest is easy to miss in a long page. Labelled as
  // leads so the judge weighs them against the content, not as a verdict.
  if (page.spamSignals.scamFacts.length > 0) {
    lines.push(
      "SIGNALS (automated checks, leads not proof):",
      ...page.spamSignals.scamFacts.map((fact) => `- ${fact}`),
    );
  }
  lines.push("MAIN CONTENT:", page.bodyText.slice(0, MAX_JUDGE_CONTENT_CHARS));
  return lines.join("\n");
}

/** Characters of site inventory handed to a judge. */
const MAX_SITE_STATE_CHARS = 12_000;

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

const exampleLine = (example: SiteExample): string =>
  `${pathOf(example.url)} "${example.title ?? ""}"`;

const clusterLine = (cluster: PatternCluster): string =>
  `${cluster.id} ${cluster.kind} ${cluster.template} — ${cluster.size} pages "${cluster.key}", words ${cluster.wordRange[0]}–${cluster.wordRange[1]} (median ${cluster.medianWords}, cv ${cluster.wordCv.toFixed(2)})`;

/**
 * The site as a judge sees it: the crawl inventory, not page text.
 *
 * Flat text for the same reason as `renderPageState`. Paths rather than full
 * URLs, because the origin is on the first line and the budget is better spent
 * on titles. Titles go last so the character cap trims the sample, never the
 * clusters the pattern rules are answered from.
 */
export function renderSiteState(
  facts: SiteFacts,
  businessOverview?: string | null,
): string {
  const lines = [
    `SITE: ${facts.origin}   CRAWLED: ${facts.pagesCrawled} pages (${facts.indexablePages} indexable)   CRAWL COMPLETE: ${facts.crawlCompleted ? "yes" : "no (stopped at the page limit)"}`,
  ];
  if (businessOverview?.trim()) {
    lines.push(`SITE CONTEXT: ${businessOverview.trim().slice(0, 800)}`);
  }
  if (facts.homepage) lines.push(`HOMEPAGE: ${exampleLine(facts.homepage)}`);
  const { trust } = facts;
  const found = (url: string | null) => (url ? pathOf(url) : "(none found)");
  lines.push(
    `TRUST PAGES: about=${found(trust.about)} contact=${found(trust.contact)} privacy=${found(trust.privacy)} terms=${found(trust.terms)} authors=${trust.authorTemplate ? `${trust.authorTemplate.template} (${trust.authorTemplate.count})` : "(none found)"}`,
    "TEMPLATES (by size):",
  );
  for (const group of facts.templates) {
    const skeleton = group.titleSkeleton
      ? `, title pattern "${group.titleSkeleton.pattern}" ${Math.round(group.titleSkeleton.coverage * 100)}%`
      : "";
    const dups = group.exactDupPages
      ? `, ${group.exactDupPages} with identical text`
      : "";
    lines.push(
      `  ${group.template} — ${group.count} pages, median ${group.medianWords} words (cv ${group.wordCv.toFixed(2)})${skeleton}${dups}`,
    );
  }
  lines.push(
    facts.clusters.length ? "PATTERN CLUSTERS:" : "PATTERN CLUSTERS: none",
  );
  for (const cluster of facts.clusters) {
    lines.push(
      `  ${clusterLine(cluster)}`,
      `     e.g. ${cluster.examples.map(exampleLine).join("; ")}`,
    );
  }
  lines.push(
    `UGC SURFACES: ${facts.ugcSurfaces.join(", ") || "none"}`,
    "TITLES (sample across sections):",
    ...facts.titleSample.map((title) => `  ${title}`),
  );
  return lines.join("\n").slice(0, MAX_SITE_STATE_CHARS);
}

/** What a judge reads for its input: a page, or the site's inventory. */
export function renderSubject(input: JudgeInput): string {
  return input.kind === "site"
    ? renderSiteState(input.site, input.businessOverview)
    : renderPageState(input.page, input.businessOverview, input.template);
}

/**
 * Which rules still need a language model after the decision model ran.
 *
 * Two groups: anything it flagged, because a finding without evidence is not
 * actionable, and anything it was unsure about, because an `unknown` is an
 * unanswered question rather than a verdict. Confident passes are left alone —
 * that is the whole saving.
 */
export function rulesNeedingSecondPass(
  judged: readonly JudgedRule[],
): Set<string> {
  const needed = new Set<string>();
  for (const result of judged) {
    if (
      result.status === "fail" ||
      result.status === "warn" ||
      result.status === "unknown"
    ) {
      needed.add(result.ruleId);
    }
  }
  return needed;
}

/**
 * Merge a second-pass answer over a first-pass one.
 *
 * The language model's status wins, because it saw the page as prose and can
 * tell a real failure from a pattern match. The decision model's confidence is
 * kept: it is the only calibrated number in the pair, and it is what makes a
 * later "how sure were we?" question answerable.
 */
export function mergeJudgements(
  first: readonly JudgedRule[],
  second: readonly JudgedRule[],
): JudgedRule[] {
  const bySecond = new Map(second.map((result) => [result.ruleId, result]));
  const merged = first.map((result) => {
    const refined = bySecond.get(result.ruleId);
    if (!refined) return result;
    return {
      ...result,
      status: refined.status,
      evidence: refined.evidence ?? result.evidence ?? null,
      reason: refined.reason ?? result.reason ?? null,
      score: refined.score ?? result.score ?? null,
    };
  });
  // A rule only the second pass answered (the first judge skipped or dropped
  // it) still belongs in the results.
  const seen = new Set(merged.map((result) => result.ruleId));
  for (const result of second) {
    if (!seen.has(result.ruleId)) merged.push(result);
  }
  return merged;
}

/** Case, quote marks and whitespace differ between a page and a quote of it. */
function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”«»"'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a judge's evidence is really the page's own words.
 *
 * Checked against what the page says — URL, title, meta description, H1s,
 * structured data and main content — and not against the SIGNALS leads the
 * judge is also shown, which are our words, not the page's. A quote elided
 * with "..." counts when every piece of it is on the page.
 */
export function isGroundedQuote(
  evidence: string | null | undefined,
  page: FetchedPage,
): boolean {
  const fragments = (evidence ?? "")
    .split(/\.{3}|…/)
    .map(normalizeForQuote)
    .filter(Boolean);
  if (fragments.length === 0) return false;
  const shown = normalizeForQuote(
    [
      page.finalUrl,
      page.title,
      page.metaDescription,
      ...page.h1s,
      JSON.stringify(page.structuredData),
      page.bodyText.slice(0, MAX_JUDGE_CONTENT_CHARS),
    ].join(" "),
  );
  return fragments.every((fragment) => shown.includes(fragment));
}

/**
 * A judged failure whose quote is not on the page becomes a warning.
 *
 * Every judge is told to quote the page for each failure, and a failure with
 * no quote, or with a "quote" the page does not contain, is an accusation
 * rather than a finding: nobody can check it, and on a critical rule it would
 * reject the page on the model's word alone. MCP callers are untrusted input
 * besides. Kept as a warning it still surfaces for review. Deterministic
 * results never pass through here; they carry the crawl data as evidence.
 */
export function withoutUngroundedFails<T extends JudgedRule>(
  result: T,
  page: FetchedPage,
): T {
  if (result.status !== "fail" || isGroundedQuote(result.evidence, page)) {
    return result;
  }
  return {
    ...result,
    status: "warn",
    reason: result.evidence?.trim()
      ? `The judge's quote is not on the page; confirm before acting. ${result.reason ?? ""}`.trim()
      : (result.reason ??
        "Flagged by the judge without a quote from the page; confirm before acting."),
  };
}

/**
 * The site's own words: every URL, title and pattern the inventory shows,
 * each cluster's line as `renderSiteState` renders it, and the clusters'
 * member URLs (a judge may name a member the sample did not show). Not the
 * business overview, which is the project's words, not the site's.
 */
function siteEvidenceText(facts: SiteFacts): string {
  const examples = (list: readonly SiteExample[]) =>
    list.flatMap((example) => [
      example.url,
      pathOf(example.url),
      example.title,
    ]);
  return [
    facts.origin,
    ...(facts.homepage ? examples([facts.homepage]) : []),
    ...[
      facts.trust.about,
      facts.trust.contact,
      facts.trust.privacy,
      facts.trust.terms,
    ]
      .filter((url) => url !== null)
      .flatMap((url) => [url, pathOf(url)]),
    facts.trust.authorTemplate?.template,
    ...facts.templates.flatMap((group) => [
      group.template,
      group.titleSkeleton?.pattern,
      ...examples(group.examples),
    ]),
    ...facts.clusters.flatMap((cluster) => [
      clusterLine(cluster),
      ...examples(cluster.examples),
      ...cluster.memberUrls.flatMap((url) => [url, pathOf(url)]),
    ]),
    ...facts.ugcSurfaces,
    ...facts.titleSample,
  ]
    .filter(Boolean)
    .join(" \n ");
}

/**
 * Whether a site finding points at something the inventory really shows.
 *
 * A finding that cites at least one cluster, all of them real, rests on the
 * clusters and needs no quote: the cluster ids are the inventory's own
 * record. Otherwise (no cluster cited, or one the facts never had) the
 * evidence must be the inventory's words. The site judge quotes URLs, titles
 * and cluster lines rather than prose, often several at once, so the evidence
 * is split on list separators as well as elisions and every piece must be
 * there.
 */
function isGroundedSiteEvidence(
  result: Pick<JudgedRule, "evidence" | "clusters">,
  facts: SiteFacts,
): boolean {
  const known = new Set(facts.clusters.map((cluster) => cluster.id));
  const cited = result.clusters ?? [];
  if (cited.length > 0 && cited.every((id) => known.has(id))) return true;
  const fragments = (result.evidence ?? "")
    .split(/\.{3}|…|[;,|\n]/)
    .map(normalizeForQuote)
    .filter(Boolean);
  if (fragments.length === 0) return false;
  const shown = normalizeForQuote(siteEvidenceText(facts));
  return fragments.every((fragment) => shown.includes(fragment));
}

/** `withoutUngroundedFails` for a site finding. */
export function withoutUngroundedSiteFails<T extends JudgedRule>(
  result: T,
  facts: SiteFacts,
): T {
  if (result.status !== "fail" || isGroundedSiteEvidence(result, facts)) {
    return result;
  }
  return {
    ...result,
    status: "warn",
    reason:
      `The judge's evidence is not in the site's crawl inventory; confirm before acting. ${result.reason ?? ""}`.trim(),
  };
}
