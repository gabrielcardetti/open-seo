/**
 * Site-audit issue types from the page signals: structured data, hreflang,
 * images, Open Graph and HTTPS. Part of the registry in audit-issues.ts.
 */
import type { AuditIssueDescriptor } from "./audit-issues";

export const PAGE_SIGNAL_ISSUE_TYPES = {
  "structured-data-invalid": {
    severity: "warning",
    title: "Invalid JSON-LD",
    explanation:
      "A JSON-LD script on the page is not valid JSON, so search engines discard the whole block: none of its structured data counts, and any rich result it was meant to earn is lost.",
    howToFix:
      "Validate the block (a JSON linter or Google's Rich Results Test points at the error). Common causes are trailing commas, unescaped quotes or line breaks inside strings, and template output that leaves a value empty.",
  },
  "structured-data-missing-properties": {
    severity: "warning",
    title: "Structured data missing required properties",
    explanation:
      "The page declares a rich-result type (Product, Event, JobPosting, Recipe...) without one or more properties Google requires for it. Without them the page is not eligible for that rich result, and Search Console reports the item as invalid.",
    howToFix:
      "Add the missing properties listed in the issue details, filled from the page's visible content. Google's structured data documentation for the type lists what is required and what is only recommended.",
  },
  "structured-data-retired-type": {
    severity: "info",
    title: "Structured data for a retired rich result",
    explanation:
      "The page uses a schema.org type whose rich result Google no longer shows (FAQPage since May 2026, HowTo since 2023, and ClaimReview, EstimatedSalary, learning videos, SpecialAnnouncement and VehicleListing since 2025). The markup does no harm, but it no longer earns anything in Google Search.",
    howToFix:
      "No action is required. Keep the markup if other consumers use it (a fact-check publisher's ClaimReview feeds Fact Check Explorer), and don't add new markup of these types expecting a rich result. Use QAPage for genuine single-question pages.",
  },
  "job-posting-expired": {
    severity: "warning",
    title: "Expired job posting still marked up",
    explanation:
      "The page carries JobPosting structured data whose validThrough date has passed. Google's job posting guidelines require expired postings to drop the markup (or the page); leaving it up can earn a manual action against the site's job listings.",
    howToFix:
      "Remove the JobPosting markup when the posting closes, or return 404/410 for the page, then notify Google (the Indexing API's URL_UPDATED or URL_DELETED, or a sitemap update) so it recrawls the page.",
  },
  "hreflang-invalid-code": {
    severity: "warning",
    title: "Invalid hreflang code",
    explanation:
      'An hreflang value is not a valid language code (ISO 639-1, optionally with an ISO 15924 script and an ISO 3166-1 region, e.g. "es", "es-ES", "zh-Hant-TW") or "x-default". Search engines ignore alternates with invalid codes. Classic mistakes: "en-UK" (the region is GB), "jp" (Japanese is ja) and a region on its own ("US").',
    howToFix:
      "Fix the codes listed in the issue details: language first, region second, separated by a hyphen.",
  },
  "hreflang-missing-self-reference": {
    severity: "warning",
    title: "Hreflang set without a self-reference",
    explanation:
      "The page lists hreflang alternates but none of them points at the page itself. Each language version should include itself in its own set, or search engines may not trust the annotations.",
    howToFix:
      "Add an hreflang link for the page's own language whose href is the page's own (canonical) URL.",
  },
  "hreflang-missing-return-link": {
    severity: "warning",
    title: "Hreflang alternate does not link back",
    explanation:
      "The page names an alternate version that was crawled but does not name this page in return. Hreflang only works when both pages confirm each other; one-way annotations are ignored.",
    howToFix:
      "Add a reciprocal hreflang link on each alternate listed in the issue details, so every language version lists every other one.",
  },
  "hreflang-on-canonicalized-page": {
    severity: "warning",
    title: "Hreflang on a canonicalized page",
    explanation:
      "The page declares hreflang alternates but canonicalizes to another URL. Search engines read hreflang only on canonical pages, so these annotations are ignored.",
    howToFix:
      "Put the hreflang annotations on the canonical URL and make every href in the set a canonical URL.",
  },
  "hreflang-mixed-protocol": {
    severity: "warning",
    title: "Hreflang set mixes http and https",
    explanation:
      "The page's hreflang alternates point at both http:// and https:// URLs. Alternates should be the canonical URLs, and after an HTTPS migration the http ones usually just redirect, which breaks the return links.",
    howToFix:
      "Point every hreflang href at the https canonical URL of each version.",
  },
  "images-missing-dimensions": {
    severity: "info",
    title: "Images without width and height",
    explanation:
      "Some images have no width and height attributes, so the browser cannot reserve their space before they load and the layout jumps when they arrive (Cumulative Layout Shift, a Core Web Vital).",
    howToFix:
      "Set width and height attributes to the image's intrinsic size (CSS can still make it responsive with height: auto), or reserve the box with CSS aspect-ratio.",
  },
  "first-image-lazy-loaded": {
    severity: "info",
    title: "First image is lazy-loaded",
    explanation:
      'The first image in the HTML has loading="lazy". When that image is in the first screen (often the hero, and the Largest Contentful Paint element), lazy loading delays it and worsens LCP. A small logo or an image further down is harmless.',
    howToFix:
      'If the image is visible on load, remove loading="lazy" from it (and consider fetchpriority="high" for the hero). Keep lazy loading for images below the fold.',
  },
  "missing-og-tags": {
    severity: "info",
    title: "Missing Open Graph tags",
    explanation:
      "The page lacks og:title, og:description or og:image. Social networks and messaging apps build link previews from these, and without them the preview is bare or picks an arbitrary image.",
    howToFix:
      "Add the missing Open Graph meta tags listed in the issue details; og:image should be an absolute URL to an image of at least 1200x630.",
  },
  "page-not-https": {
    severity: "warning",
    title: "Page served over http",
    explanation:
      "The page loaded over plain http, without TLS. Browsers mark it as not secure, HTTPS is a (light) Google ranking signal, and links to it split signals if an https version also exists.",
    howToFix:
      "Serve the site over HTTPS, 301-redirect every http URL to its https equivalent, and update internal links, canonicals and the sitemap to https.",
  },
  "missing-hsts": {
    severity: "info",
    title: "No HSTS header",
    explanation:
      "None of the crawled https pages sent a Strict-Transport-Security header. Without it, a visitor's first request can still go over http and be downgraded or intercepted before the redirect to https.",
    howToFix:
      'Send "Strict-Transport-Security: max-age=31536000; includeSubDomains" on https responses (most CDNs have a setting), once every subdomain serves https.',
  },
  "mixed-content": {
    severity: "warning",
    title: "Mixed content",
    explanation:
      "This https page loads subresources (images, scripts, stylesheets, frames) over http. Browsers block insecure scripts and frames outright and flag the page as not fully secure, which can break the page for visitors and for rendering crawlers.",
    howToFix:
      "Change the http:// URLs listed in the issue details to https:// (or paths on your own host), or serve those resources from an https host.",
  },
  // From Bing Webmaster Tools: what Bingbot saw on its own crawl, read from
  // the project's last Bing sync. Only reported when Bing is connected.
} as const satisfies Record<string, AuditIssueDescriptor>;
