/**
 * What the crawl says about a site as a whole, for the site-level rules.
 *
 * A doorway page looks ordinary on its own; what gives it away is the 214
 * siblings that differ only in the city name. This module turns the audit's
 * page inventory into that view — URL templates, clusters of near-identical
 * pages, trust pages, tripwires — without touching the network or the
 * database, so it is a pure function of the rows and fully unit-testable.
 *
 * Everything comes from columns the crawl already stores (url, title, word
 * count, exact body hash). There is no text-similarity fingerprint yet, so
 * "near-identical" is read from title and slug skeletons plus length
 * uniformity, and exact duplicates from the body hash.
 */
import { sort } from "remeda";
import { canonicalUrlKey, detectUrlTemplate } from "../audit/url-utils";
import {
  normalizeText,
  skeletonGroups,
  templateTitleSkeleton,
  titleTokens,
  wordStats,
  type SkeletonItem,
} from "./site-skeleton";
import {
  byPathLength,
  findTrust,
  findUgcSurfaces,
  hackedTripwires,
  parasiteTripwires,
  safeDecode,
  sameSiteLinks,
  segmentsOf,
  type SiteLink,
} from "./site-trust";

/** One `audit_pages` row, slim. */
export interface SiteInventoryPage {
  id: string;
  url: string;
  statusCode: number | null;
  isIndexable: boolean;
  title: string | null;
  wordCount: number;
  /** Exact SHA-256 of the body text; null when the crawl did not record it. */
  contentHash: string | null;
  crawlDepth: number | null;
}

export interface SiteExample {
  url: string;
  title: string | null;
}

export interface TemplateGroup {
  /** `detectUrlTemplate(path)`, e.g. `/blog/:slug`. */
  template: string;
  count: number;
  indexable: number;
  medianWords: number;
  /** Coefficient of variation of word counts; near 0 means stamped out. */
  wordCv: number;
  /** Pages sharing a body hash with a sibling in the group. */
  exactDupPages: number;
  /** "Abogados en {*} | Firma" and the share of titles it covers. */
  titleSkeleton: { pattern: string; coverage: number } | null;
  examples: SiteExample[];
}

export type ClusterKind = "exact_body" | "title_skeleton" | "slug_skeleton";

export interface PatternCluster {
  /** "C1".."C10", ordered by size; stable for the same inventory. */
  id: string;
  kind: ClusterKind;
  template: string;
  /** Body hash, title skeleton or slug skeleton. */
  key: string;
  size: number;
  wordRange: [number, number];
  wordCv: number;
  medianWords: number;
  /**
   * Member URLs, so page membership needs no second pass. Only the pages the
   * caller will look up when it passes `memberUrlFilter`; otherwise capped (see
   * `MAX_MEMBER_URLS`) because the facts are a workflow step's output, and
   * `membersTruncated` says the list is partial.
   */
  memberUrls: string[];
  membersTruncated: boolean;
  examples: SiteExample[];
}

export interface TrustPages {
  about: string | null;
  contact: string | null;
  privacy: string | null;
  terms: string | null;
  /** An author template such as `/autor/:slug`, with its page count. */
  authorTemplate: { template: string; count: number } | null;
}

export interface SiteTripwire {
  ruleId: "SPAM-04" | "SPAM-12";
  url: string;
  title: string | null;
  why: string;
}

export interface SiteFacts {
  origin: string;
  /** `${origin}/#site`: the stored row's URL, which no crawled URL can equal. */
  sentinelUrl: string;
  pagesCrawled: number;
  indexablePages: number;
  /** False when the crawl stopped at its page limit: absence is not evidence. */
  crawlCompleted: boolean;
  homepage: SiteExample | null;
  /** Top 25 by count. */
  templates: TemplateGroup[];
  /** Top 10 by size, each with at least `CLUSTER_MIN_SIZE` pages. */
  clusters: PatternCluster[];
  /** Up to 60 titles, spread across templates, for topical focus. */
  titleSample: string[];
  trust: TrustPages;
  /** Templates that carry user content (forums, comments, profiles). */
  ugcSurfaces: string[];
  /** Up to 10 leads for a reviewer; never a verdict on their own. */
  tripwires: SiteTripwire[];
}

/** A cluster smaller than this is a coincidence, not a pattern. */
export const CLUSTER_MIN_SIZE = 8;

/** Members kept per cluster beyond the filter, for the flagged-cluster sample. */
const REPRESENTATIVE_MEMBERS = 2;

/** Member URLs kept across all clusters, to bound the step output. */
export const MAX_MEMBER_URLS = 3000;

/** Longest title or URL kept in the facts, which are a step's output. */
const MAX_TEXT_LENGTH = 200;

const MAX_TEMPLATES = 25;
const MAX_CLUSTERS = 10;
const MAX_TITLES = 60;

interface Row {
  page: SiteInventoryPage;
  path: string;
  search: string;
  template: string;
  /** Answered 2xx: the page exists for a visitor, indexed or not. */
  ok: boolean;
  /** 2xx and indexable: the page competes in Search. */
  live: boolean;
}

function linkOf(row: Row): SiteLink {
  return {
    url: row.page.url,
    path: row.path,
    search: row.search,
    title: row.page.title,
  };
}

/** Clip to `MAX_TEXT_LENGTH`; a clipped string ends in "…". */
function clip(text: string): string {
  return text.length <= MAX_TEXT_LENGTH
    ? text
    : `${text.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

function clipOrNull(text: string | null): string | null {
  return text === null ? null : clip(text);
}

function example(row: Row): SiteExample {
  return { url: clip(row.page.url), title: clipOrNull(row.page.title) };
}

function groupRows(rows: readonly Row[], keyOf: (row: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function depthOf(row: Row): number {
  return row.page.crawlDepth ?? Number.MAX_SAFE_INTEGER;
}

function toRows(pages: readonly SiteInventoryPage[]): Row[] {
  const rows: Row[] = [];
  for (const page of pages) {
    let parsed: URL;
    try {
      parsed = new URL(page.url);
    } catch {
      continue;
    }
    const ok =
      page.statusCode !== null &&
      page.statusCode >= 200 &&
      page.statusCode < 300;
    rows.push({
      page,
      path: parsed.pathname,
      search: parsed.search,
      template: detectUrlTemplate(parsed.pathname),
      ok,
      live: ok && page.isIndexable,
    });
  }
  // Shallow pages first, then by URL: examples favour the pages a visitor
  // reaches, and nothing depends on the order the rows came back in.
  return sort(
    rows,
    (a, b) => depthOf(a) - depthOf(b) || a.page.url.localeCompare(b.page.url),
  );
}

function clipPattern(
  skeleton: TemplateGroup["titleSkeleton"],
): TemplateGroup["titleSkeleton"] {
  return skeleton && { ...skeleton, pattern: clip(skeleton.pattern) };
}

function buildTemplates(rows: readonly Row[]): TemplateGroup[] {
  const groups = Array.from(
    groupRows(rows, (row) => row.template),
    ([template, members]): TemplateGroup => {
      const live = members.filter((row) => row.live);
      const { medianWords, wordCv } = wordStats(
        live.map((row) => row.page.wordCount),
      );
      const hashes = groupRows(
        live.filter((row) => row.page.contentHash !== null),
        (row) => row.page.contentHash ?? "",
      );
      const titles = live.flatMap((row) => row.page.title?.trim() || []);
      return {
        template,
        count: members.length,
        indexable: live.length,
        medianWords,
        wordCv,
        exactDupPages: Array.from(hashes.values())
          .filter((group) => group.length > 1)
          .reduce((sum, group) => sum + group.length, 0),
        titleSkeleton: clipPattern(templateTitleSkeleton(titles)),
        examples: live.slice(0, 3).map(example),
      };
    },
  );
  return sort(
    groups,
    (a, b) => b.count - a.count || a.template.localeCompare(b.template),
  ).slice(0, MAX_TEMPLATES);
}

interface ClusterDraft {
  kind: ClusterKind;
  key: string;
  members: Row[];
}

const KIND_ORDER: Record<ClusterKind, number> = {
  exact_body: 0,
  title_skeleton: 1,
  slug_skeleton: 2,
};

function exactBodyDrafts(live: readonly Row[]): ClusterDraft[] {
  const hashed = live.filter((row) => row.page.contentHash !== null);
  return Array.from(
    groupRows(hashed, (row) => row.page.contentHash ?? ""),
    ([key, members]): ClusterDraft => ({ kind: "exact_body", key, members }),
  ).filter((draft) => draft.members.length >= CLUSTER_MIN_SIZE);
}

function titleDrafts(live: readonly Row[]): ClusterDraft[] {
  const titled = live.filter((row) => row.page.title?.trim());
  const items = titled.map((row) => ({
    scope: "",
    tokens: titleTokens(row.page.title ?? ""),
  }));
  return skeletonGroups(items, " ", CLUSTER_MIN_SIZE).map((group) => ({
    kind: "title_skeleton",
    key: group.pattern,
    members: group.members.map((index) => titled[index]),
  }));
}

/**
 * `/mejor-crm-para-dentistas` and `/mejor-crm-para-abogados` are both `/:slug`
 * to `detectUrlTemplate`; the fan-out only shows in the slug's own words.
 */
function slugDrafts(live: readonly Row[]): ClusterDraft[] {
  const slugged: Row[] = [];
  const items: SkeletonItem[] = [];
  for (const row of live) {
    const segments = segmentsOf(row.path);
    const last = segments.at(-1);
    if (last === undefined) continue;
    const parent = detectUrlTemplate(`/${segments.slice(0, -1).join("/")}`);
    slugged.push(row);
    items.push({
      scope: parent === "/" ? "/" : `${parent}/`,
      tokens: safeDecode(last).split("-").filter(Boolean),
    });
  }
  return skeletonGroups(items, "-", CLUSTER_MIN_SIZE).map((group) => ({
    kind: "slug_skeleton",
    key: group.pattern,
    members: group.members.map((index) => slugged[index]),
  }));
}

/** `/abogados/madrid` + `/abogados/sevilla` -> `/abogados/:*`. */
function commonTemplate(templates: readonly string[]): string {
  const distinct = Array.from(new Set(templates));
  if (distinct.length === 1) return distinct[0];
  const split = distinct.map((template) => template.split("/"));
  if (split.some((parts) => parts.length !== split[0].length)) return "(mixed)";
  return split[0]
    .map((part, i) => (split.every((parts) => parts[i] === part) ? part : ":*"))
    .join("/");
}

/**
 * `MAX_MEMBER_URLS` split fairly: small clusters keep every member and the
 * budget they leave goes to the larger ones, which split it evenly.
 */
function memberShares(sizes: readonly number[]): number[] {
  const shares = sizes.map(() => 0);
  const smallestFirst = sort(
    sizes.map((_, i) => i),
    (a, b) => sizes[a] - sizes[b],
  );
  let budget = MAX_MEMBER_URLS;
  smallestFirst.forEach((i, done) => {
    shares[i] = Math.min(
      sizes[i],
      Math.floor(budget / (smallestFirst.length - done)),
    );
    budget -= shares[i];
  });
  return shares;
}

function buildClusters(
  live: readonly Row[],
  memberUrlFilter: ReadonlySet<string> | undefined,
): PatternCluster[] {
  const drafts = sort(
    [...exactBodyDrafts(live), ...titleDrafts(live), ...slugDrafts(live)],
    (a, b) =>
      b.members.length - a.members.length ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.key.localeCompare(b.key),
  ).slice(0, MAX_CLUSTERS);

  const shares = memberShares(drafts.map((draft) => draft.members.length));
  return drafts.map((draft, i) => {
    // With a filter: the sampled members, plus the cluster's first few so the
    // caller can add them to the sample when the site pass flags the cluster.
    const kept = memberUrlFilter
      ? draft.members.filter(
          (row, index) =>
            index < REPRESENTATIVE_MEMBERS || memberUrlFilter.has(row.page.url),
        )
      : draft.members.slice(0, shares[i]);
    return {
      id: `C${i + 1}`,
      kind: draft.kind,
      template: commonTemplate(draft.members.map((row) => row.template)),
      key: clip(draft.key),
      size: draft.members.length,
      ...wordStats(draft.members.map((row) => row.page.wordCount)),
      // Full URLs when filtered: the list is short, and a clipped URL could
      // match a different long URL that shares its first 200 characters.
      memberUrls: kept.map((row) =>
        memberUrlFilter ? row.page.url : clip(row.page.url),
      ),
      membersTruncated: !memberUrlFilter && kept.length < draft.members.length,
      examples: draft.members.slice(0, 5).map(example),
    };
  });
}

/** Round-robin across templates, biggest first, so one section can't fill it. */
function buildTitleSample(live: readonly Row[]): string[] {
  const titled = live.filter((row) => row.page.title?.trim());
  const groups = sort(
    Array.from(groupRows(titled, (row) => row.template).values()),
    (a, b) => b.length - a.length || a[0].template.localeCompare(b[0].template),
  );
  const sample = new Set<string>();
  for (let round = 0; sample.size < MAX_TITLES; round++) {
    const layer = groups.filter((group) => round < group.length);
    if (layer.length === 0) break;
    for (const group of layer) {
      if (sample.size >= MAX_TITLES) break;
      sample.add(clip(group[round].page.title?.trim() ?? ""));
    }
  }
  return Array.from(sample);
}

export function buildSiteFacts(input: {
  pages: readonly SiteInventoryPage[];
  startUrl: string;
  crawlCompleted: boolean;
  /** Links on the homepage, when the crawl's link graph is still available. */
  homepageOutlinks?: readonly string[];
  /** The project's business overview, used by the SPAM-12 tripwire. */
  businessOverview?: string | null;
  /**
   * The only URLs `clusterMembership` will be asked about (the pages the
   * judge reviews). Cluster member lists then keep just those, uncapped.
   */
  memberUrlFilter?: ReadonlySet<string>;
}): SiteFacts {
  const origin = new URL(input.startUrl).origin;
  const rows = toRows(input.pages);
  const ok = rows.filter((row) => row.ok);
  const live = rows.filter((row) => row.live);

  const startKey = canonicalUrlKey(input.startUrl);
  const home =
    rows.find((row) => canonicalUrlKey(row.page.url) === startKey) ??
    rows.find((row) => row.path === "/");
  const homepage = home ? example(home) : null;

  // Trust pages count when they answer at all: a noindexed privacy or contact
  // page still tells a visitor who runs the site. Homepage links come after the
  // crawl, so a footer link to /contacto counts even when the crawl was
  // truncated before reaching it.
  const okLinks = ok.map(linkOf);
  const links = [
    ...byPathLength(okLinks),
    ...byPathLength(
      sameSiteLinks(input.homepageOutlinks ?? [], input.startUrl),
    ),
  ];
  const overview = normalizeText(input.businessOverview ?? "");
  const trust = findTrust(links);

  return {
    origin,
    sentinelUrl: `${origin}/#site`,
    pagesCrawled: input.pages.length,
    indexablePages: live.length,
    crawlCompleted: input.crawlCompleted,
    homepage,
    templates: buildTemplates(rows),
    clusters: buildClusters(live, input.memberUrlFilter),
    titleSample: buildTitleSample(live),
    trust: {
      about: clipOrNull(trust.about),
      contact: clipOrNull(trust.contact),
      privacy: clipOrNull(trust.privacy),
      terms: clipOrNull(trust.terms),
      authorTemplate: trust.authorTemplate,
    },
    ugcSurfaces: findUgcSurfaces(links),
    tripwires: [
      ...hackedTripwires(okLinks, homepage, overview),
      ...parasiteTripwires(live.map(linkOf), overview),
    ].map((tripwire) => ({
      ...tripwire,
      url: clip(tripwire.url),
      title: clipOrNull(tripwire.title),
    })),
  };
}

/** The ids of the clusters a URL belongs to. */
export function clusterMembership(facts: SiteFacts, url: string): string[] {
  const key = clip(url);
  return facts.clusters
    .filter(
      (cluster) =>
        cluster.memberUrls.includes(url) || cluster.memberUrls.includes(key),
    )
    .map((cluster) => cluster.id);
}
