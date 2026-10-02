/**
 * What the crawl says about a site from Bing's point of view: robots.txt as
 * Bingbot reads it, the sitemap URLs that are not canonical, temporary
 * redirects, duplicate bodies, crawl waste, and repeated titles and
 * descriptions.
 *
 * Like the rest of the site facts it is a pure function of the stored crawl
 * rows (plus the robots.txt text the crawl read), so it costs no request and
 * is fully unit-testable. Every list is capped: the facts are a workflow
 * step's output.
 */
import robotsParser from "robots-parser";
import { sort } from "remeda";
import { canonicalUrlKey } from "../audit/url-utils";

/** The crawl-row columns these facts read. */
export interface BingInventoryPage {
  url: string;
  statusCode: number | null;
  isIndexable: boolean;
  title: string | null;
  contentHash: string | null;
  fetchClass?: string | null;
  redirectUrl?: string | null;
  inSitemap?: boolean | null;
  canonicalUrl?: string | null;
  metaDescription?: string | null;
}

export interface BingRobotsFacts {
  /** Whether Bingbot's rules (its own group, else `*`) block the start URL. */
  startUrlBlocked: boolean;
  /** Crawled indexable URLs the `*` group allows and Bingbot's rules block. */
  blockedForBingOnly: string[];
  blockedForBingOnlyCount: number;
  hasBingbotGroup: boolean;
  /** `*` Disallow rules Bingbot's own group leaves out, so Bingbot crawls them. */
  droppedRules: string[];
}

export interface BingSiteFacts {
  /** Null when robots.txt was not read (missing, unreachable or not fetched). */
  robots: BingRobotsFacts | null;
  sitemap: {
    /** Crawled URLs that came from a sitemap. */
    checked: number;
    problemCount: number;
    problems: string[];
  };
  temporaryRedirects: { count: number; examples: string[] };
  duplicateBodies: {
    /** Indexable 2xx pages with a body hash, the base the groups are drawn from. */
    hashedPages: number;
    groups: number;
    pages: number;
    examples: string[];
  };
  crawlWaste: {
    crawled: number;
    parameterized: number;
    redirects: number;
    errors: number;
    duplicates: number;
  };
  /** Pages whose title or description another indexable page repeats. */
  duplicateTitleUrls: string[];
  duplicateDescriptionUrls: string[];
}

const MAX_EXAMPLES = 10;
/** Member URLs kept for the page checks when no filter says which. */
const MAX_DUPLICATE_URLS = 500;
const TEMPORARY_REDIRECTS = new Set([302, 303, 307]);
/** A user agent no robots.txt names, so the parser falls back to `*`. */
const GENERIC_AGENT = "openseo-generic-check";

const isOk = (page: BingInventoryPage) =>
  page.statusCode !== null && page.statusCode >= 200 && page.statusCode < 300;
const wasRead = (page: BingInventoryPage) =>
  !page.fetchClass || page.fetchClass === "ok";

/** One user-agent group: its agents and its path rules, as written. */
interface RobotsGroup {
  agents: string[];
  rules: Array<{ kind: "allow" | "disallow"; path: string }>;
}

/**
 * The groups of a robots.txt. Consecutive `User-agent` lines share the rules
 * that follow them; a `User-agent` line after a rule starts a new group.
 * Agent names are compared as robots-parser does: lowercased, without a
 * `/version` suffix (`bingbot/2.0` is Bingbot's group).
 */
function robotsGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase().split("/")[0].trim());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current && (field === "allow" || field === "disallow")) {
      current.rules.push({ kind: field, path: value });
    }
  }
  return groups;
}

const ruleKey = (rule: RobotsGroup["rules"][number]) =>
  `${rule.kind}:${rule.path}`;

/** `Allow: /` or an empty `Disallow:`: the rule that lets a bot crawl everything. */
const allowsAll = (rule: RobotsGroup["rules"][number]) =>
  (rule.kind === "allow" && rule.path === "/") ||
  (rule.kind === "disallow" && rule.path === "");

/** `Disallow: /`: the rule that shuts a bot out of the whole site. */
const blocksAll = (rule: RobotsGroup["rules"][number]) =>
  rule.kind === "disallow" && (rule.path === "/" || rule.path === "/*");

/** A URL a robots path pattern matches, to test it against Bingbot's rules. */
function sampleUrlFor(origin: string, pattern: string): string {
  const path = pattern.replace(/\*/g, "").replace(/\$$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function bingRobotsFacts(input: {
  robotsText: string;
  startUrl: string;
  indexableUrls: readonly string[];
}): BingRobotsFacts {
  const origin = new URL(input.startUrl).origin;
  const robots = robotsParser(`${origin}/robots.txt`, input.robotsText);
  const bingAllows = (url: string) => robots.isAllowed(url, "bingbot") ?? true;
  const genericAllows = (url: string) =>
    robots.isAllowed(url, GENERIC_AGENT) ?? true;

  const groups = robotsGroups(input.robotsText);
  const bingRules = groups
    .filter((group) => group.agents.includes("bingbot"))
    .flatMap((group) => group.rules);
  const hasBingbotGroup = groups.some((group) =>
    group.agents.includes("bingbot"),
  );
  const bingKeys = new Set(bingRules.map(ruleKey));
  const genericRules = groups
    .filter((group) => group.agents.includes("*"))
    .flatMap((group) => group.rules);
  // Letting Bingbot in on purpose is not the trap BING-02 is about: a Bingbot
  // group that only allows everything (`Allow: /`, an empty `Disallow:`), or
  // any Bingbot group on a site whose `*` group shuts every other bot out
  // (an allowlist), was written to differ from `*`.
  const deliberate =
    (bingRules.length > 0 && bingRules.every(allowsAll)) ||
    genericRules.some(blocksAll);
  // A `*` Disallow missing from Bingbot's group only matters when Bingbot's
  // rules then let it through; a stricter Bingbot group already covers it.
  const droppedRules =
    hasBingbotGroup && !deliberate
      ? genericRules
          .filter(
            (rule) =>
              rule.kind === "disallow" &&
              rule.path !== "" &&
              !bingKeys.has(ruleKey(rule)) &&
              bingAllows(sampleUrlFor(origin, rule.path)),
          )
          .map((rule) => `Disallow: ${rule.path}`)
      : [];

  const blockedForBingOnly = sort(
    input.indexableUrls.filter((url) => genericAllows(url) && !bingAllows(url)),
    (a, b) => a.localeCompare(b),
  );
  return {
    startUrlBlocked: !bingAllows(input.startUrl),
    blockedForBingOnly: blockedForBingOnly.slice(0, MAX_EXAMPLES),
    blockedForBingOnlyCount: blockedForBingOnly.length,
    hasBingbotGroup,
    droppedRules: [...new Set(droppedRules)].slice(0, MAX_EXAMPLES),
  };
}

/** Why a sitemap URL is not one Bing wants listed, or null when it is. */
function sitemapProblem(page: BingInventoryPage): string | null {
  const status = page.statusCode;
  if (status === null) return null;
  if (status >= 300 && status < 400) {
    return `redirects (${status}${page.redirectUrl ? ` → ${page.redirectUrl}` : ""})`;
  }
  if (status >= 400) return `answers ${status}`;
  if (!page.isIndexable) return "noindex";
  if (
    page.canonicalUrl &&
    canonicalUrlKey(page.canonicalUrl) !== canonicalUrlKey(page.url)
  ) {
    return `canonical is ${page.canonicalUrl}`;
  }
  return null;
}

function groupBy(
  pages: readonly BingInventoryPage[],
  keyOf: (page: BingInventoryPage) => string | null,
): BingInventoryPage[][] {
  const groups = new Map<string, BingInventoryPage[]>();
  for (const page of pages) {
    const key = keyOf(page);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(page);
    else groups.set(key, [page]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/** URLs of every page in a repeated group, narrowed to the ones asked about. */
function repeatedUrls(
  groups: readonly BingInventoryPage[][],
  memberUrlFilter: ReadonlySet<string> | undefined,
): string[] {
  const urls = groups.flatMap((group) => group.map((page) => page.url));
  const kept = memberUrlFilter
    ? urls.filter((url) => memberUrlFilter.has(url))
    : urls;
  return sort(kept, (a, b) => a.localeCompare(b)).slice(0, MAX_DUPLICATE_URLS);
}

const normalized = (text: string | null | undefined) =>
  text?.trim().toLowerCase().replace(/\s+/g, " ") || null;

export function buildBingSiteFacts(input: {
  pages: readonly BingInventoryPage[];
  startUrl: string;
  /** robots.txt as the crawl read it; null when missing or unreadable, undefined when not fetched. */
  robotsText?: string | null;
  memberUrlFilter?: ReadonlySet<string>;
}): BingSiteFacts {
  const pages = sort(input.pages.filter(wasRead), (a, b) =>
    a.url.localeCompare(b.url),
  );
  const live = pages.filter((page) => isOk(page) && page.isIndexable);

  const sitemapPages = pages.filter((page) => page.inSitemap);
  const sitemapProblems = sitemapPages.flatMap((page) => {
    const why = sitemapProblem(page);
    return why ? [`${page.url} ${why}`] : [];
  });

  const temporary = pages.filter(
    (page) =>
      page.statusCode !== null && TEMPORARY_REDIRECTS.has(page.statusCode),
  );

  const hashed = live.filter((page) => page.contentHash);
  const bodyGroups = sort(
    groupBy(hashed, (page) => page.contentHash),
    (a, b) => b.length - a.length || a[0].url.localeCompare(b[0].url),
  );
  const duplicatePages = bodyGroups.reduce((sum, g) => sum + g.length, 0);

  return {
    robots:
      typeof input.robotsText === "string"
        ? bingRobotsFacts({
            robotsText: input.robotsText,
            startUrl: input.startUrl,
            indexableUrls: live.map((page) => page.url),
          })
        : null,
    sitemap: {
      checked: sitemapPages.length,
      problemCount: sitemapProblems.length,
      problems: sitemapProblems.slice(0, MAX_EXAMPLES),
    },
    temporaryRedirects: {
      count: temporary.length,
      examples: temporary
        .slice(0, MAX_EXAMPLES)
        .map(
          (page) =>
            `${page.url} (${page.statusCode}${page.redirectUrl ? ` → ${page.redirectUrl}` : ""})`,
        ),
    },
    duplicateBodies: {
      hashedPages: hashed.length,
      groups: bodyGroups.length,
      pages: duplicatePages,
      examples: bodyGroups.slice(0, 5).map((group) =>
        group
          .slice(0, 3)
          .map((page) => page.url)
          .join(" = "),
      ),
    },
    crawlWaste: {
      crawled: pages.length,
      parameterized: pages.filter((page) => page.url.includes("?")).length,
      redirects: pages.filter(
        (page) =>
          page.statusCode !== null &&
          page.statusCode >= 300 &&
          page.statusCode < 400,
      ).length,
      errors: pages.filter(
        (page) => page.statusCode !== null && page.statusCode >= 400,
      ).length,
      // Every copy past the first is waste.
      duplicates: duplicatePages - bodyGroups.length,
    },
    duplicateTitleUrls: repeatedUrls(
      groupBy(live, (page) => normalized(page.title)),
      input.memberUrlFilter,
    ),
    duplicateDescriptionUrls: repeatedUrls(
      groupBy(live, (page) => normalized(page.metaDescription)),
      input.memberUrlFilter,
    ),
  };
}
