/**
 * Registry of site-audit issue types.
 *
 * Shared between the server (issue engine, MCP tools) and the client
 * (issues UI, CSV export). Each issue row in `audit_issues` references one
 * of these types by id.
 */

export type IssueSeverity = "critical" | "warning" | "info";

interface AuditIssueDescriptor {
  severity: IssueSeverity;
  title: string;
  explanation: string;
  howToFix: string;
}

export const AUDIT_ISSUE_TYPES = {
  "blocked-page": {
    severity: "critical",
    title: "Crawler was blocked",
    explanation:
      "The site returned a bot challenge or access denial (e.g. a Cloudflare challenge or a 403) instead of the page. We report this honestly rather than pretending the page is broken — but it means this page could not be audited, and other crawlers like search engines may face similar friction.",
    howToFix:
      'If you own this site, allowlist the "OpenSEO-Audit" user agent in your WAF/bot-protection settings (on Cloudflare: a WAF custom rule that skips bot protection when the user agent contains "OpenSEO-Audit"; on some free tiers you may need to relax bot protection). Then re-run the audit. On Shopify, use Crawler access instead (Online Store → Preferences → Crawler access) and paste the signature into OpenSEO under Settings → Crawler access.',
  },
  "rate-limited-page": {
    severity: "warning",
    title: "Rate limited (429)",
    explanation:
      "The server answered 429 Too Many Requests, so this page could not be audited. The crawler waits before retrying when the site's cooldown fits within the audit time limit.",
    howToFix:
      'Raise the rate limit for crawlers, or allowlist the "OpenSEO-Audit" user agent in your rate-limiting rules (on Cloudflare: a rate-limiting rule exception matching that user agent). Then re-run the audit. Re-running with fewer pages also helps if the limit is strict. On Shopify, use Crawler access instead (Online Store → Preferences → Crawler access) and paste the signature into OpenSEO under Settings → Crawler access.',
  },
  "crawl-rate-limited": {
    severity: "warning",
    title: "Crawl stopped early: rate limit",
    explanation:
      "The site asked the crawler to wait longer than the audit time limit allowed. We stopped requesting pages. This report is incomplete; URLs we did not fetch are not recorded as broken or rate limited.",
    howToFix:
      "Re-run the audit after the site's rate limit resets, or ask the site owner to allow the OpenSEO-Audit crawler. On Shopify, use Crawler access instead (Online Store → Preferences → Crawler access) and paste the signature into OpenSEO under Settings → Crawler access.",
  },
  "server-error": {
    severity: "critical",
    title: "Server error (5xx)",
    explanation:
      "The page returned a 5xx server error. Search engines that repeatedly see server errors will crawl the site less and may drop the page from the index.",
    howToFix:
      "Check the server logs for this URL and fix the underlying error. If the page is gone, return a 404/410 or redirect it to a relevant page instead of erroring.",
  },
  "broken-internal-link": {
    severity: "critical",
    title: "Broken internal link",
    explanation:
      "This page links to an internal URL that returns an error status (4xx/5xx). Broken links waste crawl budget, leak link equity, and frustrate users — they are among the most common and most damaging technical SEO issues.",
    howToFix:
      "Update the link to point at the correct live URL, or remove it. If the target was moved, prefer linking directly to the new URL rather than relying on a redirect.",
  },
  "missing-title": {
    severity: "critical",
    title: "Missing title tag",
    explanation:
      "The page has no <title>. The title is the strongest on-page relevance signal and the headline shown in search results; without it search engines generate one themselves, usually badly.",
    howToFix:
      "Add a unique, descriptive <title> of roughly 50–60 characters that includes the page's primary topic.",
  },
  "broken-page": {
    severity: "warning",
    title: "Page returns an error (4xx)",
    explanation:
      "This crawled URL returned a client error (e.g. 404). If it is referenced from your sitemap or other pages, crawlers keep wasting requests on it.",
    howToFix:
      "If the page should exist, restore it. If it is intentionally gone, remove it from the sitemap and internal links, and consider a 301 redirect to the closest live page.",
  },
  "duplicate-title": {
    severity: "warning",
    title: "Duplicate title",
    explanation:
      "Multiple pages share the same title tag. Search engines use titles to differentiate pages; duplicates make pages compete with each other and depress click-through rates.",
    howToFix:
      "Write a unique title for each page describing its specific content. For templated pages, include the distinguishing attribute (name, category, location) in the template.",
  },
  "duplicate-meta-description": {
    severity: "warning",
    title: "Duplicate meta description",
    explanation:
      "Multiple pages share the same meta description, so search results show identical snippets and users cannot tell the pages apart.",
    howToFix:
      "Write a unique meta description per page, or remove the duplicated one entirely — search engines will generate a snippet from page content, which beats a wrong duplicate.",
  },
  "duplicate-content": {
    severity: "warning",
    title: "Duplicate page content",
    explanation:
      "Two or more URLs serve byte-identical visible text. Search engines pick one version to index and ignore the rest, and ranking signals get split across the duplicates.",
    howToFix:
      "Consolidate duplicates: pick the canonical URL, add rel=canonical from the others, and 301-redirect duplicate URLs where possible (common causes: trailing-slash variants, URL parameters, http/https or www variants).",
  },
  "missing-meta-description": {
    severity: "warning",
    title: "Missing meta description",
    explanation:
      "The page has no meta description. Search engines will assemble a snippet from page text, which is often less compelling and hurts click-through rate.",
    howToFix:
      "Add a meta description of roughly 70–160 characters that summarizes the page and gives a reason to click.",
  },
  "missing-h1": {
    severity: "warning",
    title: "Missing H1 heading",
    explanation:
      "The page has no H1. The H1 tells users and search engines what the page is about; pages without one tend to have weaker topical clarity.",
    howToFix:
      "Add a single H1 that states the page's main topic, consistent with the title tag.",
  },
  "multiple-h1": {
    severity: "warning",
    title: "Multiple H1 headings",
    explanation:
      "The page has more than one H1, which dilutes the main-topic signal and usually indicates a templating mistake (e.g. a logo and a headline both marked up as H1).",
    howToFix:
      "Keep one H1 for the page's main heading and demote the others to H2/H3 (or unstyled elements for non-headings like logos).",
  },
  "redirect-chain": {
    severity: "warning",
    title: "Redirect chain",
    explanation:
      "Reaching the final page requires two or more consecutive redirects. Each hop adds latency, leaks link equity, and burns crawl budget; long chains may not be followed at all.",
    howToFix:
      "Point the first URL (and any internal links) directly at the final destination so there is at most one redirect.",
  },
  "redirect-loop": {
    severity: "warning",
    title: "Redirect loop",
    explanation:
      "This redirect eventually points back to itself, so the URL never resolves. Browsers and crawlers give up with an error.",
    howToFix:
      "Trace the redirect rules for this URL and break the cycle so the chain terminates at a real 200 page.",
  },
  "canonical-conflict": {
    severity: "warning",
    title: "Conflicting canonical signals",
    explanation:
      "The page declares different canonical URLs in its HTML <link rel=canonical> and its HTTP Link header. When signals conflict, search engines ignore both and choose their own canonical.",
    howToFix:
      "Pick one canonical URL and declare it in exactly one place (HTML head is the most common); remove or align the other declaration.",
  },
  "thin-content": {
    severity: "warning",
    title: "Thin content",
    explanation:
      "The page has very little visible text. Thin pages rarely rank, can drag down sitewide quality assessments, and (if the site renders client-side) may indicate content invisible to plain-HTML crawlers.",
    howToFix:
      "Either expand the page with genuinely useful content, noindex it, or consolidate it into a stronger page. If the content exists but is rendered by JavaScript, ensure it is server-rendered or pre-rendered.",
  },
  "images-missing-alt": {
    severity: "warning",
    title: "Images missing alt text",
    explanation:
      "One or more images on the page lack alt attributes. Alt text is an accessibility requirement and the main way search engines understand images.",
    howToFix:
      'Add descriptive alt text to meaningful images; use an empty alt (alt="") only for purely decorative ones.',
  },
  "orphan-page": {
    severity: "warning",
    title: "Orphan page",
    explanation:
      "No crawled page links to this URL — it was only discoverable via the sitemap. Pages without internal links receive little crawl attention and no internal link equity, and users can't find them by browsing.",
    howToFix:
      "Link to this page from relevant pages (navigation, related content, hub pages), or remove it from the sitemap if it shouldn't be indexed.",
  },
  "no-outgoing-links": {
    severity: "warning",
    title: "Page has no outgoing links",
    explanation:
      "The page contains no links at all — a dead end. Link equity that flows into it stops there, crawlers have nowhere to go next, and users have to reach for the back button.",
    howToFix:
      "Add links to related pages, the parent category, or the homepage. If the page's navigation is rendered by JavaScript, make sure it also exists in the server-rendered HTML.",
  },
  "title-too-long": {
    severity: "info",
    title: "Title too long",
    explanation:
      "The title exceeds ~60 characters, so search results will truncate it and the ending may be cut off mid-phrase.",
    howToFix:
      "Shorten the title to roughly 50–60 characters, front-loading the most important words.",
  },
  "title-too-short": {
    severity: "info",
    title: "Title too short",
    explanation:
      "The title is under ~10 characters, which is usually too generic to describe the page or attract clicks.",
    howToFix:
      "Expand the title into a descriptive phrase (roughly 30–60 characters) that states what the page offers.",
  },
  "meta-description-too-long": {
    severity: "info",
    title: "Meta description too long",
    explanation:
      "The meta description exceeds ~160 characters, so search engines will truncate the snippet.",
    howToFix:
      "Trim the description to roughly 70–160 characters while keeping the core message and call to action.",
  },
  "meta-description-too-short": {
    severity: "info",
    title: "Meta description too short",
    explanation:
      "The meta description is under ~70 characters. Short descriptions waste the snippet space search results give you, and search engines often ignore them in favor of text pulled from the page.",
    howToFix:
      "Expand the description to roughly 70–160 characters that summarize the page and give a reason to click.",
  },
  "heading-order-skip": {
    severity: "info",
    title: "Heading levels skip",
    explanation:
      "The heading hierarchy skips levels (e.g. an H4 directly after an H2). This weakens document structure for accessibility tools and content parsing.",
    howToFix:
      "Adjust heading levels so they descend one step at a time (H1 → H2 → H3) without skipping.",
  },
  "slow-response": {
    severity: "info",
    title: "Slow server response",
    explanation:
      "The HTML response took over 1.5 seconds. Slow time-to-first-byte drags down every downstream performance metric and reduces crawl rate on large sites.",
    howToFix:
      "Investigate server/database time and caching for this route; serving cached or statically generated HTML usually fixes it.",
  },
  "noindex-page": {
    severity: "info",
    title: "Page is noindex",
    explanation:
      "The page asks search engines not to index it (via robots meta tag or X-Robots-Tag header). That's often intentional — this is a heads-up, not an error.",
    howToFix:
      "If this page should rank, remove the noindex directive. If it's intentional (admin, thank-you, filter pages), no action is needed.",
  },
  "canonicalized-page": {
    severity: "info",
    title: "Canonicalized to another URL",
    explanation:
      "The page declares a different URL as its canonical, telling search engines to index that URL instead. Fine when intentional (parameter pages, syndication) — a problem if this page was meant to rank.",
    howToFix:
      "If this page should rank on its own, set its canonical to itself. Otherwise no action is needed.",
  },
  "deep-page": {
    severity: "info",
    title: "Page is deep in the site structure",
    explanation:
      "The page is 5+ clicks from the homepage. Deep pages get crawled less often and receive less link equity.",
    howToFix:
      "Add links from higher-level pages (hubs, category pages, navigation) to flatten the path to this page.",
  },
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
      "The page uses a schema.org type whose rich result Google no longer shows (FAQPage since May 2026, HowTo since 2023, and ClaimReview, EstimatedSalary, SpecialAnnouncement and VehicleListing since 2025). The markup does no harm, but it no longer earns anything in Google Search.",
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
  "bing-malware": {
    severity: "critical",
    title: "Bing flagged malware",
    explanation:
      "Bing Webmaster Tools reports that this URL contains malware. Bing warns searchers away from flagged pages or drops them from results, and Copilot won't cite them.",
    howToFix:
      "Scan the page and the server for injected scripts, unexpected redirects, and compromised plugins or dependencies, and clean them up. Then request a malware review in Bing Webmaster Tools (Security → Malware).",
  },
  "bing-crawl-error": {
    severity: "warning",
    title: "Bing can't crawl this URL",
    explanation:
      "Bing Webmaster Tools reports an error when Bingbot fetches this URL: a 4xx or 5xx status, a timeout, or a DNS failure. Bing may see a different answer than our crawler did, for example when bot protection blocks Bingbot. Pages Bing can't fetch drop out of Bing, Copilot, and the AI answers built on Bing's index.",
    howToFix:
      "Fix the error if the page should exist, or return a 404/410 and remove it from your sitemap and internal links if it is gone. If the page loads for you, check that your firewall or CDN doesn't block or rate-limit Bingbot, then use URL Inspection in Bing Webmaster Tools to confirm.",
  },
  "bing-blocked-by-robots": {
    severity: "warning",
    title: "Blocked for Bingbot by robots.txt",
    explanation:
      "Bing Webmaster Tools reports that robots.txt stops Bingbot from crawling this URL. Bing then can't read the page, so it can't rank it well or cite it in Copilot answers. A `User-agent: bingbot` group in robots.txt replaces the `*` group for Bing.",
    howToFix:
      "If the page should appear in Bing, remove or narrow the Disallow rule that matches it (check both the `*` and any `bingbot` group). If blocking is intentional, no action is needed.",
  },
} as const satisfies Record<string, AuditIssueDescriptor>;

export type AuditIssueType = keyof typeof AUDIT_ISSUE_TYPES;

export const ISSUE_SEVERITY_ORDER: Record<IssueSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const issueRegistry: Record<string, AuditIssueDescriptor> = AUDIT_ISSUE_TYPES;

export function getIssueDescriptor(
  issueType: string,
): AuditIssueDescriptor | null {
  return issueRegistry[issueType] ?? null;
}
