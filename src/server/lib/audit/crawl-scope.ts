/**
 * The sections of a site an audit covers.
 *
 * Sometimes only one section of a site is being worked on, and the crawl
 * should stay inside it. That is applied where the crawl already decides what
 * it may fetch — alongside robots.txt — so a page outside the section is never
 * seeded from a sitemap nor followed from a link. Leaving sections out is the
 * other half, and lives in `@/shared/audit-exclude-paths`.
 */
import type { RobotsResult } from "./discovery";

const MAX_SCOPE_PATHS = 20;
const MAX_PATH_LENGTH = 200;

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

/**
 * The site's robots rules, with everything outside the included path prefixes
 * disallowed on top. No prefixes means the whole site.
 */
export function scopeRobots(
  robots: RobotsResult,
  includedPaths: readonly string[],
): RobotsResult {
  if (includedPaths.length === 0) return robots;
  return {
    ...robots,
    isAllowed: (url) =>
      robots.isAllowed(url) && isUnderPaths(url, includedPaths),
  };
}
