/**
 * Per-page issue reporters.
 *
 * Each reporter is a pure function over a single crawled page record —
 * DOM-free by design (HTML parsing runs once in crawlPage), so the engine works
 * over any crawl source that can produce a CrawledPageResult.
 *
 * Cross-page checks (duplicates, broken links, orphans, redirect chains)
 * live in multipage.ts and run over D1 after the crawl.
 */
import type { AuditIssueType } from "@/shared/audit-issues";
import type { CrawledPageResult } from "@/server/lib/audit/types";

export interface DetectedIssue {
  issueType: AuditIssueType;
  pageId: string | null;
  pageUrl: string;
  details?: Record<string, unknown>;
  /**
   * Distinguishes multiple issues of the same type on the same page
   * (e.g. one broken-internal-link issue per target). Part of the
   * deterministic row id, so step retries don't duplicate issues.
   */
  dedupeKey?: string;
}

const TITLE_MAX_CHARS = 60;
const TITLE_MIN_CHARS = 10;
const META_DESCRIPTION_MAX_CHARS = 160;
const META_DESCRIPTION_MIN_CHARS = 70;
const THIN_CONTENT_WORDS = 150;
const SLOW_RESPONSE_MS = 1500;
const DEEP_PAGE_DEPTH = 5;
/** Structured-data findings listed per issue; the rest are counted. */
const MAX_DETAIL_ITEMS = 10;

/**
 * hreflang values: an ISO 639-1 language, then an optional ISO 15924 script
 * and an optional ISO 3166-1 alpha-2 region, or x-default.
 */
const HREFLANG_PATTERN = /^([a-z]{2})(?:-[a-z]{4})?(?:-([a-z]{2}))?$/i;
const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], {
  type: "language",
  fallback: "none",
});
const REGION_NAMES = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
});

function isValidHreflang(code: string): boolean {
  if (code.toLowerCase() === "x-default") return true;
  const match = HREFLANG_PATTERN.exec(code);
  if (!match) return false;
  const [, language, region] = match;
  if (!LANGUAGE_NAMES.of(language)) return false;
  if (!region) return true;
  // ICU accepts UK as an alias, but hreflang needs ISO 3166-1's GB.
  return region.toUpperCase() !== "UK" && Boolean(REGION_NAMES.of(region));
}

function hasHeadingLevelSkip(headingOrder: number[]): boolean {
  for (let i = 1; i < headingOrder.length; i++) {
    if (headingOrder[i] > headingOrder[i - 1] + 1) return true;
  }
  return false;
}

export function runPageReporters(page: CrawledPageResult): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const report = (
    issueType: AuditIssueType,
    details?: Record<string, unknown>,
  ) => issues.push({ issueType, pageId: page.id, pageUrl: page.url, details });

  if (page.fetchClass === "blocked") {
    report("blocked-page", { statusCode: page.statusCode });
    return issues;
  }
  if (page.fetchClass === "rate_limited") {
    report("rate-limited-page", { statusCode: page.statusCode });
    return issues;
  }
  if (page.fetchClass === "error") {
    return issues;
  }

  if (page.statusCode >= 500) {
    report("server-error", { statusCode: page.statusCode });
    return issues;
  }
  if (page.statusCode >= 400) {
    report("broken-page", { statusCode: page.statusCode });
    return issues;
  }
  // Redirects are normal on their own; chains/loops are flagged in multipage.
  if (page.statusCode >= 300) {
    return issues;
  }

  if (page.responseTimeMs > SLOW_RESPONSE_MS) {
    report("slow-response", { responseTimeMs: page.responseTimeMs });
  }
  const isHttps = page.url.startsWith("https://");
  if (!isHttps) {
    report("page-not-https");
  }

  // Content checks only make sense for analyzed HTML documents (a PDF has no
  // title tag to miss; an empty-shell HTML page very much does).
  if (!page.isHtml) {
    return issues;
  }

  // Titles and meta descriptions shape the search snippet, which a noindex
  // page never gets, so only a missing title (still shown in the browser tab)
  // is reported for one.
  if (!page.title) {
    report("missing-title");
  } else if (page.isIndexable && page.title.length > TITLE_MAX_CHARS) {
    report("title-too-long", { length: page.title.length });
  } else if (page.isIndexable && page.title.length < TITLE_MIN_CHARS) {
    report("title-too-short", { length: page.title.length });
  }

  if (page.isIndexable) {
    if (!page.metaDescription) {
      report("missing-meta-description");
    } else if (page.metaDescription.length > META_DESCRIPTION_MAX_CHARS) {
      report("meta-description-too-long", {
        length: page.metaDescription.length,
      });
    } else if (page.metaDescription.length < META_DESCRIPTION_MIN_CHARS) {
      report("meta-description-too-short", {
        length: page.metaDescription.length,
      });
    }
  }

  // Headings
  if (page.h1Count === 0) {
    report("missing-h1");
  } else if (page.h1Count > 1) {
    report("multiple-h1", { h1Count: page.h1Count });
  }
  if (hasHeadingLevelSkip(page.headingOrder)) {
    report("heading-order-skip");
  }

  // Indexability + canonical signals
  if (!page.isIndexable) {
    report("noindex-page", {
      robotsMeta: page.robotsMeta,
      xRobotsTag: page.xRobotsTag,
    });
  }
  if (
    page.canonicalUrl &&
    page.headerCanonicalUrl &&
    page.canonicalUrl !== page.headerCanonicalUrl
  ) {
    report("canonical-conflict", {
      htmlCanonical: page.canonicalUrl,
      headerCanonical: page.headerCanonicalUrl,
    });
  }
  const effectiveCanonical = page.canonicalUrl ?? page.headerCanonicalUrl;
  if (effectiveCanonical && effectiveCanonical !== page.url) {
    report("canonicalized-page", { canonicalUrl: effectiveCanonical });
  }

  // Content quality
  if (page.isIndexable && page.wordCount < THIN_CONTENT_WORDS) {
    report("thin-content", { wordCount: page.wordCount });
  }
  if (page.imagesMissingAlt > 0) {
    report("images-missing-alt", {
      imagesMissingAlt: page.imagesMissingAlt,
      imagesTotal: page.imagesTotal,
    });
  }
  if (page.imagesMissingDimensions > 0) {
    report("images-missing-dimensions", {
      imagesMissingDimensions: page.imagesMissingDimensions,
      imagesTotal: page.imagesTotal,
    });
  }
  if (page.firstImageLazy) {
    report("first-image-lazy-loaded", { src: page.images[0]?.src ?? null });
  }
  // Link previews matter for pages people share, which noindex pages are not.
  if (page.isIndexable) {
    const missing = [
      page.ogTitle ? null : "og:title",
      page.ogDescription ? null : "og:description",
      page.ogImage ? null : "og:image",
    ].filter((tag) => tag !== null);
    if (missing.length > 0) report("missing-og-tags", { missing });
  }

  // Structured data
  const structuredData = page.structuredData;
  if (structuredData.invalidBlocks > 0) {
    report("structured-data-invalid", {
      invalidBlocks: structuredData.invalidBlocks,
    });
  }
  if (structuredData.missingProperties.length > 0) {
    report("structured-data-missing-properties", {
      items: structuredData.missingProperties.slice(0, MAX_DETAIL_ITEMS),
      itemCount: structuredData.missingProperties.length,
    });
  }
  if (structuredData.retiredTypes.length > 0) {
    report("structured-data-retired-type", {
      types: structuredData.retiredTypes,
    });
  }
  if (structuredData.expiredJobPostings.length > 0) {
    report("job-posting-expired", {
      postings: structuredData.expiredJobPostings.slice(0, MAX_DETAIL_ITEMS),
    });
  }

  // Hreflang annotations of this page alone; return links are cross-page.
  if (page.hreflangLinks.length > 0) {
    const codes = new Set(page.hreflangLinks.map((link) => link.hreflang));
    const invalidCodes = Array.from(codes).filter(
      (code) => !isValidHreflang(code),
    );
    if (invalidCodes.length > 0) {
      report("hreflang-invalid-code", { codes: invalidCodes });
    }
    const hrefs = page.hreflangLinks.map((link) => link.href);
    if (
      hrefs.some((href) => href.startsWith("http://")) &&
      hrefs.some((href) => href.startsWith("https://"))
    ) {
      report("hreflang-mixed-protocol");
    }
    if (effectiveCanonical && effectiveCanonical !== page.url) {
      report("hreflang-on-canonicalized-page", {
        canonicalUrl: effectiveCanonical,
      });
    } else if (!hrefs.includes(page.url)) {
      report("hreflang-missing-self-reference");
    }
  }

  // Security. Missing HSTS is a site-wide header, reported once in multipage.
  if (isHttps && page.insecureSubresourceCount > 0) {
    report("mixed-content", {
      insecureCount: page.insecureSubresourceCount,
      samples: page.insecureSubresources,
    });
  }

  // Structure
  if (page.isIndexable && page.links.length === 0) {
    report("no-outgoing-links");
  }
  if (page.crawlDepth !== null && page.crawlDepth >= DEEP_PAGE_DEPTH) {
    report("deep-page", { crawlDepth: page.crawlDepth });
  }

  return issues;
}
