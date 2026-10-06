# Audit page signals and drift

## Status

Accepted

## Context

The site audit checked titles, descriptions, headings, canonicals and links, but not several signals that decide how a page appears in search or whether it loads safely: whether its JSON-LD parses and earns a rich result, whether its hreflang set is valid and reciprocal, whether images reserve their space, whether the likely LCP image is lazy-loaded, whether it has Open Graph tags, and whether it is served over HTTPS without insecure subresources. It also stored too little to compare two audits beyond issue counts and content hashes. A canonical pointed at another page, a title rewritten by a CMS update or a schema type swapped out raises no issue on its own, so comparing issues alone missed exactly the changes a deploy tends to cause by accident.

## Decision

### New per-page signals

The page analyzer, still a streaming parser rather than a DOM, now also extracts the raw text of each JSON-LD script, every `<link rel="alternate" hreflang>` with its href resolved against the page, `width`, `height` and `loading` on images, the first non-empty H1, and `http://` subresources (images, scripts, frames, media, stylesheets and preloads). The crawler records whether the response sent `Strict-Transport-Security`.

The H1 text and the HSTS flag are columns on the page row. A page's schema.org types and its hreflang alternates are child tables with one row per type and per (code, href). They are relational because the cross-page hreflang check joins them, and the comparison reads types per URL. The older column that held hreflang codes as JSON is no longer written. The rest (JSON-LD findings, image counts, insecure URLs) becomes issues and is not stored.

### Structured data

Only top-level JSON-LD nodes and `@graph` members are checked. Nested entities (an Offer inside a Product) are valid markup that a shallow pass cannot judge, so it stays quiet about them rather than guess.

- **Invalid JSON-LD** (warning): a block that is not valid JSON. Empty blocks are ignored.
- **Missing required properties** (warning): a small table of Google rich-result types and the properties Google documents as required, with alternatives where Google accepts any one of several (a Product needs `offers`, `review` or `aggregateRating`). Recommended properties are left out, and Article and Organization have no required properties, so they are never flagged. A JobPosting needs `jobLocation`, or `applicantLocationRequirements` when `jobLocationType` is `TELECOMMUTE`.
- **Retired rich result** (info): FAQPage, HowTo, ClaimReview, EstimatedSalary, SpecialAnnouncement, VehicleListing and learning videos (a VideoObject that is also a LearningResource). The issue says the markup does no harm and does not tell the user to remove it. Course is not on the list: the Course info result was retired, but the course list carousel still uses Course.
- **Expired job posting** (warning): a JobPosting whose `validThrough` has passed. Google can take manual action against expired postings that keep their markup.

### Hreflang

On each page with alternates: codes that are not an ISO 639-1 language with an optional ISO 15924 script and ISO 3166-1 region, or `x-default` (a region on its own and `en-UK` are invalid); a set that mixes http and https hrefs; a set on a page that canonicalizes elsewhere, where search engines ignore it; and otherwise a set that does not include the page itself. After the crawl, a cross-page check finds alternates that were crawled, return 2xx and are self-canonical but do not list the source page back. It is an anti-join in SQL, so a large multilingual site never loads every annotation into memory. Alternates outside the crawl are not judged.

### Images, previews and security

- **Images without width and height** (info): `data:` placeholders are excluded.
- **First image lazy-loaded** (info): `loading="lazy"` on the first image in the HTML, which is often the LCP element. Missing lazy loading is never reported.
- **Missing Open Graph tags** (info): og:title, og:description or og:image absent on an indexable page.
- **Page served over http** (warning), and **mixed content** (warning) on https pages, with a sample of the insecure URLs.
- **No HSTS header** (info): reported once per https origin whose crawled pages never sent the header, not on every page.

### Drift between audits

`compare_audits` gains a `drift` block. For every URL both audits crawled it compares stored signals and names each change by rule:

- critical: canonical changed, canonical removed, noindex added, title removed, H1 removed, status became 4xx or 5xx, structured data removed;
- warning: title changed, meta description changed or removed, H1 changed, Open Graph tags removed, schema types changed;
- info: structured data added.

Whitespace-only edits are not changes. When the page now errors, only the status change is reported. Pages that are not 2xx on both sides (redirects, pages that were already failing) carry no content signals to compare. Each rule comes with an exact count and a capped list of examples (URL, before, after). Audits that predate H1 text and schema types simply produce no drift for those rules, because a rule fires only when the earlier audit had a value.

## Rationale

**Checks that don't cry wolf.** Each check reports what search engines or browsers actually act on. Recommended schema properties, nested entities, lazy loading that is merely absent, and hreflang targets outside the crawl are left alone, because a report full of maybes trains users to ignore it.

**Retired types as information.** FAQ and HowTo markup is still valid schema.org and other consumers read it. Telling users to strip it would trade a no-op for work and risk; telling them it no longer earns a Google rich result is what they need.

**HSTS once.** The header is a server setting. One issue per origin is one fix; one per page would bury every other finding.

**Drift beside issues, not as issues.** An issue says a page is wrong now; drift says it changed. A new title can be better than the old one, so drift is a comparison output with its own severities, not a crawl finding stored with every audit.

**Store just enough to compare.** The H1 text and schema types are stored because drift needs them across audits. The JSON-LD itself, image attributes and insecure URLs are only needed during the crawl, so they become issues and are dropped.

## Consequences

- Audits run before this change have no hreflang rows, schema types, H1 text or HSTS flag. Comparisons against them report no drift for H1 and schema types.
- Rich-result requirements are a fixed table that must follow Google's documentation as it changes.
- Hreflang return links are checked only between crawled pages, so a scoped or capped crawl can miss gaps that a full crawl would find.
