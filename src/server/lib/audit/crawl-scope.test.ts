import { describe, expect, it } from "vitest";
import { isUnderPaths, normalizeScopePaths, scopeRobots } from "./crawl-scope";

describe("crawl scope", () => {
  // People paste paths in every shape; the root would name the whole site.
  it("normalizes what people type and drops the root", () => {
    expect(
      normalizeScopePaths([
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
    // Whole segments only: a sibling that shares the prefix is not under it.
    ["https://example.com/bopvfaq", false],
    ["https://example.com/guias/bopv", false],
    ["https://example.com/", false],
  ])("%s under /bopv: %s", (url, under) => {
    expect(isUnderPaths(url, ["/bopv"])).toBe(under);
  });

  // The crawl seeds sitemaps and follows links through robots.isAllowed, so
  // this is the one gate an out-of-scope page has to fail.
  it("disallows everything out of scope on top of the site's robots rules", () => {
    const robots = scopeRobots(
      {
        isAllowed: (url) => !url.includes("/private"),
        sitemapUrls: [],
      },
      { includedPaths: ["/bopv"], excludedPaths: ["/bopv/archivo"] },
    );
    expect(robots.isAllowed("https://example.com/bopv/1")).toBe(true);
    expect(robots.isAllowed("https://example.com/bopv/archivo/2023")).toBe(
      false,
    );
    expect(robots.isAllowed("https://example.com/guias/x")).toBe(false);
    expect(robots.isAllowed("https://example.com/bopv/private")).toBe(false);
  });
});
