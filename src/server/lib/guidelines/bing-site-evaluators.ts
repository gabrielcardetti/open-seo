/**
 * Bing's site rules settled from the crawl inventory and robots.txt (see
 * bing-site-facts.ts). Thresholds that are ours, not Bing's (temporary
 * redirects, duplicate bodies, crawl waste), only ever warn.
 */
import type { DeterministicResult, SiteEvaluator } from "./evaluator-support";

const noFacts: DeterministicResult = {
  status: "unknown",
  reason: "Site pages were not inspected.",
};

const noRobots: DeterministicResult = {
  status: "unknown",
  reason: "robots.txt could not be read (missing or unreachable).",
};

export const bingSiteEvaluators: Record<string, SiteEvaluator> = {
  "BING-01": (facts) => {
    if (!facts) return noFacts;
    const robots = facts.bing.robots;
    if (!robots) return noRobots;
    if (robots.startUrlBlocked) {
      return {
        status: "fail",
        evidence: `robots.txt disallows ${facts.homepage?.url ?? facts.origin} for Bingbot`,
        reason: "Bingbot is not allowed to crawl the site's start page.",
      };
    }
    if (robots.blockedForBingOnlyCount > 0) {
      return {
        status: "warn",
        evidence: `${robots.blockedForBingOnlyCount} crawled page(s): ${robots.blockedForBingOnly.join(", ")}`,
        reason:
          "robots.txt blocks these indexable pages for Bingbot while letting other crawlers in.",
      };
    }
    return { status: "pass" };
  },

  "BING-02": (facts) => {
    if (!facts) return noFacts;
    const robots = facts.bing.robots;
    if (!robots) return noRobots;
    if (!robots.hasBingbotGroup) {
      return { status: "pass", evidence: "No group for Bingbot." };
    }
    return robots.droppedRules.length > 0
      ? {
          status: "fail",
          evidence: robots.droppedRules.join(", "),
          reason:
            "Bingbot's own group leaves out these rules of the * group, and Bingbot ignores the * group once it has its own.",
        }
      : { status: "pass" };
  },

  "BING-04": (facts) => {
    if (!facts) return noFacts;
    const { checked, problemCount, problems } = facts.bing.sitemap;
    if (checked === 0) {
      return {
        status: "unknown",
        reason: "No crawled URL came from a sitemap.",
      };
    }
    return problemCount > 0
      ? {
          status: "fail",
          evidence:
            `${problemCount} of ${checked} sitemap URLs: ${problems.join("; ")}`.slice(
              0,
              1000,
            ),
          reason:
            "The sitemap lists URLs that are not canonical, live and indexable.",
        }
      : {
          status: "pass",
          evidence: `${checked} sitemap URLs checked (lastmod not checked).`,
        };
  },

  // The crawl sees the status, not how long it has been served.
  "BING-05": (facts) => {
    if (!facts) return noFacts;
    const { count, examples } = facts.bing.temporaryRedirects;
    if (count > 0) {
      return {
        status: "warn",
        evidence:
          `${count} temporary redirect(s): ${examples.join(", ")}`.slice(
            0,
            1000,
          ),
        reason:
          "If any of these serves a permanent change or lasts more than 2 days, Bing wants a 301.",
      };
    }
    return facts.bing.crawlWaste.crawled > 0 ? { status: "pass" } : noFacts;
  },

  "BING-10": (facts) => {
    if (!facts) return noFacts;
    const { hashedPages, groups, pages, examples } = facts.bing.duplicateBodies;
    if (groups > 0) {
      return {
        status: "warn",
        evidence:
          `${pages} indexable pages in ${groups} group(s) with the same body: ${examples.join("; ")}`.slice(
            0,
            1000,
          ),
        reason:
          "The same content answers on several URLs; a canonical alone does not fix that for Bing.",
      };
    }
    return hashedPages >= 2
      ? { status: "pass" }
      : {
          status: "unknown",
          reason: "Too few pages with recorded text to compare.",
        };
  },

  "BING-11": (facts) => {
    if (!facts) return noFacts;
    const { crawled, parameterized, redirects, errors, duplicates } =
      facts.bing.crawlWaste;
    if (crawled < 20) {
      return {
        status: "unknown",
        reason: "Too few URLs crawled to judge crawl waste.",
      };
    }
    const wasted = Math.min(
      crawled,
      parameterized + redirects + errors + duplicates,
    );
    const breakdown = `${parameterized} with parameters, ${redirects} redirects, ${errors} errors, ${duplicates} duplicate copies of ${crawled} crawled URLs`;
    return wasted / crawled >= 0.25
      ? {
          status: "warn",
          evidence: breakdown,
          reason: "A large share of the crawl goes to low-value URLs.",
        }
      : { status: "pass", evidence: breakdown };
  },
};
