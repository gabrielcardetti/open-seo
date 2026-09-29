import { describe, expect, it } from "vitest";
import {
  isExcludedPath,
  normalizeExcludedPaths,
  scopeRobots,
} from "./crawl-scope";

describe("crawl scope", () => {
  // People paste paths in every shape; the root would exclude the whole site.
  it("normalizes what people type and drops the root", () => {
    expect(
      normalizeExcludedPaths([
        "/bopv",
        "bopv/",
        "https://example.com/tag/?x=1",
        "/",
        "  ",
      ]),
    ).toEqual(["/bopv", "/tag"]);
  });

  it.each([
    ["https://example.com/bopv", true],
    ["https://example.com/bopv/", true],
    ["https://example.com/bopv/2026/01/55", true],
    ["https://example.com/bopv?q=%22462%22", true],
    // Whole segments only: a sibling that shares the prefix stays in.
    ["https://example.com/bopvfaq", false],
    ["https://example.com/guias/bopv", false],
    ["https://example.com/", false],
  ])("%s excluded: %s", (url, excluded) => {
    expect(isExcludedPath(url, ["/bopv"])).toBe(excluded);
  });

  // The crawl seeds sitemaps and follows links through robots.isAllowed, so
  // this is the one gate an excluded page has to fail.
  it("disallows excluded paths on top of the site's robots rules", () => {
    const robots = scopeRobots(
      {
        isAllowed: (url) => !url.includes("/private"),
        sitemapUrls: [],
      },
      ["/bopv"],
    );
    expect(robots.isAllowed("https://example.com/bopv/1")).toBe(false);
    expect(robots.isAllowed("https://example.com/private")).toBe(false);
    expect(robots.isAllowed("https://example.com/guias/x")).toBe(true);
  });
});
