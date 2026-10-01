/**
 * Sections of a site an audit leaves out.
 *
 * A site can carry a section that should not be audited with the rest: a
 * generated archive of thousands of pages, a section handled elsewhere, one
 * being rebuilt. Crawling it spends the page budget on it and buries the rest
 * of the site's findings under its own. Excluded paths are applied where the
 * crawl already decides what it may fetch — alongside robots.txt — so an
 * excluded page is never seeded from a sitemap nor followed from a link.
 */
import type { RobotsResult } from "./discovery";

const MAX_EXCLUDED_PATHS = 20;
const MAX_PATH_LENGTH = 200;

/**
 * A path prefix as the crawl compares it: leading slash, no trailing slash,
 * no query or fragment. Accepts a full URL too, since that is what people
 * paste. Returns null for the root, which would exclude the whole site.
 */
function normalizeExcludedPath(raw: string): string | null {
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
export function normalizeExcludedPaths(raw: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const entry of raw) {
    const path = normalizeExcludedPath(entry);
    if (path) paths.add(path);
  }
  return [...paths].slice(0, MAX_EXCLUDED_PATHS);
}

/**
 * Whether a URL falls under an excluded path. Matched on whole path segments:
 * "/bopv" excludes "/bopv", "/bopv/2026/01/55" and "/bopv?q=x", not
 * "/bopvfaq".
 */
export function isExcludedPath(
  url: string,
  excludedPaths: readonly string[],
): boolean {
  if (excludedPaths.length === 0) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return false;
  }
  return excludedPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** The site's robots rules, with the excluded paths disallowed on top. */
export function scopeRobots(
  robots: RobotsResult,
  excludedPaths: readonly string[],
): RobotsResult {
  if (excludedPaths.length === 0) return robots;
  return {
    ...robots,
    isAllowed: (url) =>
      robots.isAllowed(url) && !isExcludedPath(url, excludedPaths),
  };
}
