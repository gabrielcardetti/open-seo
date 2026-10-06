import { describe, expect, it } from "vitest";
import {
  findDuplicates,
  findMissingHreflangReturnLinks,
  findMissingHsts,
  findRedirectChainsAndLoops,
  type SlimPage,
} from "@/server/lib/audit/issues/multipage-checks";

function makeSlimPage(overrides: Partial<SlimPage>): SlimPage {
  return {
    id: overrides.url ?? "page",
    url: "https://example.com/a",
    statusCode: 200,
    fetchClass: "ok",
    title: null,
    metaDescription: null,
    contentHash: null,
    redirectUrl: null,
    wordCount: 100,
    isIndexable: true,
    canonicalUrl: null,
    headerCanonicalUrl: null,
    hasHsts: false,
    ...overrides,
  };
}

describe("findMissingHreflangReturnLinks", () => {
  const pages = [
    makeSlimPage({ id: "en", url: "https://example.com/en" }),
    makeSlimPage({ id: "es", url: "https://example.com/es" }),
    makeSlimPage({
      id: "fr",
      url: "https://example.com/fr",
      canonicalUrl: "https://example.com/en",
    }),
  ];

  it("flags a page whose crawled alternates do not link back", () => {
    expect(
      findMissingHreflangReturnLinks(pages, [
        { sourcePageId: "en", targetPageId: "es" },
        // A canonicalized alternate is a different problem.
        { sourcePageId: "en", targetPageId: "fr" },
      ]),
    ).toEqual([
      {
        issueType: "hreflang-missing-return-link",
        pageId: "en",
        pageUrl: "https://example.com/en",
        details: { alternates: ["https://example.com/es"], alternateCount: 1 },
      },
    ]);
  });
});

describe("findMissingHsts", () => {
  it("reports an https origin once when none of its pages sent HSTS", () => {
    const issues = findMissingHsts([
      makeSlimPage({ id: "home", url: "https://example.com/" }),
      makeSlimPage({ id: "a", url: "https://example.com/a" }),
      makeSlimPage({
        id: "b",
        url: "https://blog.example.com/b",
        hasHsts: true,
      }),
      makeSlimPage({ id: "c", url: "https://blog.example.com/c" }),
      makeSlimPage({ id: "http", url: "http://legacy.example.com/" }),
    ]);
    expect(issues).toEqual([
      {
        issueType: "missing-hsts",
        pageId: "home",
        pageUrl: "https://example.com/",
        details: { pagesChecked: 2 },
      },
    ]);
  });
});

describe("findDuplicates", () => {
  it("flags duplicate titles across pages and includes the other URLs", () => {
    const issues = findDuplicates([
      makeSlimPage({ url: "https://example.com/a", title: "Same" }),
      makeSlimPage({ url: "https://example.com/b", title: "Same" }),
      makeSlimPage({ url: "https://example.com/c", title: "Different" }),
    ]);
    const duplicateTitles = issues.filter(
      (issue) => issue.issueType === "duplicate-title",
    );
    expect(duplicateTitles).toHaveLength(2);
    expect(duplicateTitles[0].details?.otherUrls).toEqual([
      "https://example.com/b",
    ]);
  });

  it("excludes noindexed, canonicalized, and blocked pages from duplicate groups", () => {
    const issues = findDuplicates([
      makeSlimPage({ url: "https://example.com/a", title: "Same" }),
      makeSlimPage({
        url: "https://example.com/b",
        title: "Same",
        canonicalUrl: "https://example.com/a",
      }),
      makeSlimPage({
        url: "https://example.com/c",
        title: "Same",
        isIndexable: false,
      }),
      makeSlimPage({
        url: "https://example.com/d",
        title: "Same",
        fetchClass: "blocked",
        statusCode: 403,
      }),
    ]);
    expect(issues).toHaveLength(0);
  });

  it("groups duplicate content by hash only when there is text", () => {
    const issues = findDuplicates([
      makeSlimPage({ url: "https://example.com/a", contentHash: "h1" }),
      makeSlimPage({ url: "https://example.com/b", contentHash: "h1" }),
      makeSlimPage({
        url: "https://example.com/empty-1",
        contentHash: "h2",
        wordCount: 0,
      }),
      makeSlimPage({
        url: "https://example.com/empty-2",
        contentHash: "h2",
        wordCount: 0,
      }),
    ]);
    expect(
      issues.filter((issue) => issue.issueType === "duplicate-content"),
    ).toHaveLength(2);
  });
});

describe("findRedirectChainsAndLoops", () => {
  const redirect = (url: string, target: string) =>
    makeSlimPage({ url, statusCode: 301, redirectUrl: target });

  it("ignores single redirects", () => {
    expect(
      findRedirectChainsAndLoops([
        redirect("https://example.com/a", "https://example.com/b"),
        makeSlimPage({ url: "https://example.com/b" }),
      ]),
    ).toHaveLength(0);
  });

  it("flags a chain once, on its head", () => {
    const issues = findRedirectChainsAndLoops([
      redirect("https://example.com/a", "https://example.com/b"),
      redirect("https://example.com/b", "https://example.com/c"),
      makeSlimPage({ url: "https://example.com/c" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("redirect-chain");
    expect(issues[0].pageUrl).toBe("https://example.com/a");
    expect(issues[0].details?.hops).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });

  it.each([
    [
      "a two-page loop",
      [
        redirect("https://example.com/a", "https://example.com/b"),
        redirect("https://example.com/b", "https://example.com/a"),
      ],
    ],
    [
      "a self-loop",
      [redirect("https://example.com/a", "https://example.com/a")],
    ],
  ])("flags %s once", (_case, pages) => {
    const issues = findRedirectChainsAndLoops(pages);
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("redirect-loop");
  });
});
