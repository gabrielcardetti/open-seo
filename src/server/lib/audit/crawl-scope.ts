/**
 * The sections of a site an audit covers.
 *
 * A site can carry a section that should not be audited with the rest: a
 * generated archive of thousands of pages, a section handled elsewhere, one
 * being rebuilt. Crawling it spends the page budget on it and buries the rest
 * of the site's findings under its own. The opposite also happens: only one
 * section is being worked on, and the crawl should stay inside it. Both are
 * applied where the crawl already decides what it may fetch — alongside
 * robots.txt — so an out-of-scope page is never seeded from a sitemap nor
 * followed from a link.
 */
import type { RobotsResult } from "./discovery";

const MAX_SCOPE_PATHS = 20;
const MAX_PATH_LENGTH = 200;

export interface CrawlScope {
  /** When non-empty, only pages under these path prefixes are crawled. */
  includedPaths: readonly string[];
  /** Pages under these path prefixes are never crawled. */
  excludedPaths: readonly string[];
}

/**
 * A path prefix as the crawl compares it: leading slash, no trailing slash,
 * no query or fragment. Accepts a full URL too, since that is what people
 * paste. Returns null for the root, which as a prefix names the whole site.
 */
function normalizeScopePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_PATH_LENGTH) return null;
  let path = trimmed;
  try {
    path = new URL(trimmed).pathname;
  } catch {
    // Not a URL: a bare path such as "/bopv" or "bopv/".
  }
  path = path.split(/[?#]/)[0] ?? "";
  path = `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return path === "/" ? null : path;
}

/** Normalized, deduplicated and capped; entries that name nothing are dropped. */
export function normalizeScopePaths(raw: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const entry of raw) {
    const path = normalizeScopePath(entry);
    if (path) paths.add(path);
  }
  return [...paths].slice(0, MAX_SCOPE_PATHS);
}

/**
 * Whether a URL falls under one of the path prefixes. Matched on whole path
 * segments: "/bopv" covers "/bopv", "/bopv/2026/01/55" and "/bopv?q=x", not
 * "/bopvfaq".
 */
export function isUnderPaths(url: string, paths: readonly string[]): boolean {
  if (paths.length === 0) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return false;
  }
  return paths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isScopedCrawl(scope: CrawlScope): boolean {
  return scope.includedPaths.length > 0 || scope.excludedPaths.length > 0;
}

/** Whether a URL is inside the audit's scope (robots.txt aside). */
function isInScope(url: string, scope: CrawlScope): boolean {
  return (
    (scope.includedPaths.length === 0 ||
      isUnderPaths(url, scope.includedPaths)) &&
    !isUnderPaths(url, scope.excludedPaths)
  );
}

/** The site's robots rules, with everything out of scope disallowed on top. */
export function scopeRobots(
  robots: RobotsResult,
  scope: CrawlScope,
): RobotsResult {
  if (!isScopedCrawl(scope)) return robots;
  return {
    ...robots,
    isAllowed: (url) => robots.isAllowed(url) && isInScope(url, scope),
  };
}
