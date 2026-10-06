import { describe, expect, it } from "vitest";
import { runPageReporters } from "@/server/lib/audit/issues/page-reporters";
import {
  EMPTY_STRUCTURED_DATA,
  summarizeStructuredData,
} from "@/server/lib/audit/structured-data";
import type { CrawledPageResult, PageLink } from "@/server/lib/audit/types";

const HEALTHY_LINK: PageLink = {
  targetUrl: "https://example.com/catalog",
  anchor: "Catalog",
  isInternal: true,
  isNofollow: false,
};

function makePage(overrides: Partial<CrawledPageResult>): CrawledPageResult {
  return {
    id: "page-1",
    url: "https://example.com/a",
    statusCode: 200,
    fetchClass: "ok",
    redirectUrl: null,
    title: "A perfectly reasonable page title",
    metaDescription:
      "A reasonable meta description that says something useful about the page.",
    canonicalUrl: null,
    robotsMeta: null,
    xRobotsTag: null,
    headerCanonicalUrl: null,
    ogTitle: "A",
    ogDescription: "A page",
    ogImage: "https://example.com/a.png",
    h1Count: 1,
    h1Text: "A heading",
    h2Count: 0,
    h3Count: 0,
    h4Count: 0,
    h5Count: 0,
    h6Count: 0,
    headingOrder: [1, 2, 3],
    wordCount: 500,
    contentHash: "abc123",
    isHtml: true,
    htmlBytes: 10_000,
    rateLimited: false,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    imagesMissingDimensions: 0,
    firstImageLazy: false,
    images: [],
    links: [HEALTHY_LINK],
    hasStructuredData: false,
    structuredData: EMPTY_STRUCTURED_DATA,
    hreflangLinks: [],
    hasHsts: true,
    insecureSubresources: [],
    insecureSubresourceCount: 0,
    isIndexable: true,
    responseTimeMs: 200,
    crawlDepth: 1,
    inSitemap: true,
    ...overrides,
  };
}

function issueTypes(page: CrawledPageResult): string[] {
  return runPageReporters(page).map((issue) => issue.issueType);
}

describe("runPageReporters", () => {
  it("keeps known signals on an unread shell without inventing missing-content issues", () => {
    const types = issueTypes(
      makePage({
        javascriptShell: true,
        title: "",
        metaDescription: "",
        h1Count: 0,
        wordCount: 1,
        links: [],
        isIndexable: false,
        robotsMeta: "noindex",
        canonicalUrl: "https://example.com/canonical",
        headerCanonicalUrl: "https://example.com/header-canonical",
        responseTimeMs: 2000,
        crawlDepth: 5,
      }),
    );
    expect(types).toEqual([
      "slow-response",
      "noindex-page",
      "canonical-conflict",
      "canonicalized-page",
      "deep-page",
      "javascript-rendering-suspected",
    ]);
  });

  it("reports nothing for a healthy page", () => {
    expect(issueTypes(makePage({}))).toEqual([]);
  });

  // A fetch that never produced a page yields exactly its fetch issue, and
  // none of the content checks.
  it.each([
    [{ fetchClass: "blocked", statusCode: 403 }, ["blocked-page"]],
    [{ fetchClass: "rate_limited", statusCode: 429 }, ["rate-limited-page"]],
    [{ fetchClass: "error", statusCode: 0 }, []],
  ] as const)("reports %o as %j", (overrides, expected) => {
    expect(issueTypes(makePage(overrides))).toEqual(expected);
  });

  it("classifies error statuses by range", () => {
    expect(issueTypes(makePage({ statusCode: 500 }))).toEqual(["server-error"]);
    expect(issueTypes(makePage({ statusCode: 404 }))).toEqual(["broken-page"]);
    expect(
      issueTypes(
        makePage({
          statusCode: 301,
          redirectUrl: "https://example.com/b",
        }),
      ),
    ).toEqual([]);
  });

  it.each<[Partial<CrawledPageResult>, string]>([
    [{ title: "" }, "missing-title"],
    [{ title: "x".repeat(70) }, "title-too-long"],
    [{ title: "Tiny" }, "title-too-short"],
    [{ metaDescription: "" }, "missing-meta-description"],
    [{ metaDescription: "x".repeat(200) }, "meta-description-too-long"],
    [{ metaDescription: "x".repeat(69) }, "meta-description-too-short"],
    [{ h1Count: 0 }, "missing-h1"],
    [{ h1Count: 3 }, "multiple-h1"],
    [{ headingOrder: [1, 2, 4] }, "heading-order-skip"],
    [{ wordCount: 50 }, "thin-content"],
    [{ responseTimeMs: 3000 }, "slow-response"],
    [{ crawlDepth: 6 }, "deep-page"],
    [{ links: [] }, "no-outgoing-links"],
    [{ imagesMissingDimensions: 2 }, "images-missing-dimensions"],
    [{ firstImageLazy: true }, "first-image-lazy-loaded"],
    [{ ogImage: null }, "missing-og-tags"],
    [{ url: "http://example.com/a" }, "page-not-https"],
    [{ insecureSubresourceCount: 1 }, "mixed-content"],
  ])("flags %o as %s", (overrides, issueType) => {
    expect(issueTypes(makePage(overrides))).toContain(issueType);
  });

  it.each<[Partial<CrawledPageResult>, string]>([
    [{ metaDescription: "x".repeat(70) }, "meta-description-too-short"],
    [
      { wordCount: 50, isIndexable: false, robotsMeta: "noindex" },
      "thin-content",
    ],
    [{ crawlDepth: null }, "deep-page"],
    [{ links: [], isIndexable: false }, "no-outgoing-links"],
    [{ ogImage: null, isIndexable: false }, "missing-og-tags"],
    // An http page's own insecurity is the issue, not its subresources.
    [
      { url: "http://example.com/a", insecureSubresourceCount: 1 },
      "mixed-content",
    ],
    // Snippet checks: a noindex page never shows a title or description in
    // search results.
    [{ title: "x".repeat(90), isIndexable: false }, "title-too-long"],
    [
      { metaDescription: undefined, isIndexable: false },
      "missing-meta-description",
    ],
  ])("does not flag %o as %s", (overrides, issueType) => {
    expect(issueTypes(makePage(overrides))).not.toContain(issueType);
  });

  it("reports the measured length with a short meta description", () => {
    expect(
      runPageReporters(makePage({ metaDescription: "x".repeat(69) })).find(
        (issue) => issue.issueType === "meta-description-too-short",
      )?.details,
    ).toEqual({ length: 69 });
  });

  // The same empty shell: a PDF gets no content checks, an HTML page all of them.
  it.each([
    [false, []],
    [
      true,
      [
        "missing-title",
        "missing-meta-description",
        "missing-h1",
        "thin-content",
      ],
    ],
  ])("with isHtml %s an empty shell reports %j", (isHtml, expected) => {
    expect(
      issueTypes(
        makePage({
          isHtml,
          title: "",
          metaDescription: "",
          h1Count: 0,
          headingOrder: [],
          wordCount: 0,
          contentHash: null,
        }),
      ),
    ).toEqual(expected);
  });

  it("flags indexability and canonical signals", () => {
    expect(
      issueTypes(makePage({ isIndexable: false, robotsMeta: "noindex" })),
    ).toContain("noindex-page");

    const conflicted = issueTypes(
      makePage({
        canonicalUrl: "https://example.com/canonical-a",
        headerCanonicalUrl: "https://example.com/canonical-b",
      }),
    );
    expect(conflicted).toContain("canonical-conflict");
    expect(conflicted).toContain("canonicalized-page");

    expect(
      issueTypes(makePage({ canonicalUrl: "https://example.com/a" })),
    ).not.toContain("canonicalized-page");
  });
});

describe("structured data and hreflang reporters", () => {
  const NOW = new Date("2026-10-06T00:00:00Z");
  const withJsonLd = (...blocks: unknown[]) =>
    issueTypes(
      makePage({
        structuredData: summarizeStructuredData(
          blocks.map((block) =>
            typeof block === "string" ? block : JSON.stringify(block),
          ),
          NOW,
        ),
      }),
    );

  it.each<[string, unknown, string[]]>([
    ["invalid JSON", '{"@type": "Article",}', ["structured-data-invalid"]],
    ["complete Article", { "@type": "Article" }, []],
    [
      "a Product with neither offers nor ratings",
      { "@type": "Product", name: "Mug" },
      ["structured-data-missing-properties"],
    ],
    [
      "a retired FAQPage",
      { "@type": "FAQPage", mainEntity: [] },
      ["structured-data-retired-type"],
    ],
    [
      "a learning video",
      {
        "@type": ["VideoObject", "LearningResource"],
        name: "Lesson",
        thumbnailUrl: "https://example.com/t.png",
        uploadDate: "2026-01-01",
      },
      ["structured-data-retired-type"],
    ],
    [
      "a remote job without applicant location",
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "JobPosting",
            title: "Engineer",
            description: "Build things",
            datePosted: "2026-09-01",
            hiringOrganization: { name: "Acme" },
            jobLocationType: "TELECOMMUTE",
            validThrough: "2026-09-30",
          },
        ],
      },
      ["structured-data-missing-properties", "job-posting-expired"],
    ],
  ])("reports %s as %j", (_case, block, expected) => {
    expect(withJsonLd(block)).toEqual(expected);
  });

  const hreflangIssues = (
    hreflangLinks: CrawledPageResult["hreflangLinks"],
    overrides: Partial<CrawledPageResult> = {},
  ) => issueTypes(makePage({ hreflangLinks, ...overrides }));
  const SELF = { hreflang: "en", href: "https://example.com/a" };

  it("accepts language, script and region codes and x-default", () => {
    expect(
      hreflangIssues([
        SELF,
        { hreflang: "es-ES", href: "https://example.com/es" },
        { hreflang: "zh-Hant-TW", href: "https://example.com/tw" },
        { hreflang: "x-default", href: "https://example.com/" },
      ]),
    ).toEqual([]);
  });

  it("lists invalid codes", () => {
    const issues = runPageReporters(
      makePage({
        hreflangLinks: ["en-UK", "US", "jp", "en_US", "fr"]
          .map((hreflang) => ({
            hreflang,
            href: `https://example.com/${hreflang}`,
          }))
          .concat(SELF),
      }),
    );
    expect(
      issues.find((issue) => issue.issueType === "hreflang-invalid-code")
        ?.details,
    ).toEqual({ codes: ["en-UK", "US", "jp", "en_US"] });
  });

  it.each<
    [
      string,
      CrawledPageResult["hreflangLinks"],
      Partial<CrawledPageResult>,
      string[],
    ]
  >([
    [
      "a set without the page itself",
      [{ hreflang: "es", href: "https://example.com/es" }],
      {},
      ["hreflang-missing-self-reference"],
    ],
    [
      "a set on a canonicalized page",
      [SELF],
      { canonicalUrl: "https://example.com/b" },
      ["canonicalized-page", "hreflang-on-canonicalized-page"],
    ],
    [
      "http and https alternates",
      [SELF, { hreflang: "es", href: "http://example.com/es" }],
      {},
      ["hreflang-mixed-protocol"],
    ],
  ])("flags %s", (_case, links, overrides, expected) => {
    expect(hreflangIssues(links, overrides)).toEqual(expected);
  });
});
