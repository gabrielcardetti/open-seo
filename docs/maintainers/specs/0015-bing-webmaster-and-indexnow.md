# Bing Webmaster Tools and IndexNow integration

## Status

Accepted

## Context

OpenSEO read only Google's first-party data (Search Console and Analytics). Bing's index also serves Copilot and other search and answer products, and users had no way to see their Bing clicks, the crawl problems Bingbot reports, or which URLs they had told search engines about. Announcing new pages was a manual ping that left no record.

The Bing Webmaster API has two properties that shape the design. It serves a fixed, rolling window of about six months and takes no date range, so a live read cannot answer "this month versus last month" once the older month falls out of the window, and nothing older than the window can be read at all. Its query and page statistics come in weekly buckets rather than per day.

Telling engines about URLs has two routes: IndexNow, an open protocol that one request shares with every participating engine (Bing, Yandex, Naver, Seznam and others), and Bing's own URL submission API, which is quota-limited. Google takes part in neither.

## Decision

Add a native Bing Webmaster connection that keeps its own daily history, an indexing feature that announces new and changed URLs with a per-URL record, and MCP tools for both. Everything here is free: neither Bing nor IndexNow charges for these calls, so no credits are metered, the same as Search Console.

### Connection

Each OpenSEO user saves one Bing Webmaster API key. OpenSEO checks the key against Bing (by listing the account's sites) before storing it, and a key Bing rejects is never stored. Saving a new key replaces the previous one, whether or not the old one still works. Keys are encrypted at rest with the deployment's `BETTER_AUTH_SECRET`, and only the last four characters are ever shown back.

A project connects to one site that is verified in the Bing account behind the key. The site URL is stored exactly as Bing spells it (scheme and trailing slash included), because Bing matches it byte for byte. As with Search Console, the connection belongs to the project: any member can read its data, and syncs run with the key of the member who connected it. Choosing the site, disconnecting, pausing sync and running a sync on demand require permission to manage integrations. If the connecting member deletes their key, the project stops syncing until someone reconnects it; its history stays.

### Daily snapshots

Once a day, a scheduled job downloads everything the API serves for each connected site and stores it: site-wide clicks and impressions per day, query and page statistics in Bing's weekly buckets, crawl statistics per day, the URLs Bing reports crawl issues for, the sitemaps Bing knows, the remaining URL submission quota, and (weekly) inbound link counts per page. Each dataset is best-effort, so one failing method does not stop the others. A rejected or throttled key, or a key whose account lost access to the site, ends the run, since every later call would fail the same way. Sitemaps Bing stops listing are kept and marked as no longer reported. Each sync also registers the project's tracked sitemaps that Bing does not list yet (spec 0017). Users and agents can also sync on demand, at most once every ten minutes per project, counted from the last sync that started, successful or not; every sync claims the project with a compare-and-set on its next scheduled time, so concurrent requests start one sync.

Rows are upserted by their natural key and never replaced by an older window, so the stored history keeps growing past Bing's six months. The first sync stores whatever Bing's window still holds. Snapshot rows record the site they came from, so switching a project to another Bing site never mixes two histories, and reconnecting the same site brings its history back. A crawl issue that stops appearing is marked resolved, and reopens if Bing reports it again.

Reads in the app and over MCP come from this history. Only three things call Bing live: drilling into the queries for one page or the pages for one query, listing the pages that link to one URL, and keyword statistics.

### AI Performance

Bing reports how often Copilot and its AI answers cite a site, but offers no API for it. Users import the report's CSV export instead: citations per day, cited pages, and grounding queries. Bing documents no format for the export, so the import recognises columns by their header names, detects which of the three reports a file holds (or takes the user's choice), asks for the exported period when a file has no date column, and reports the rows it skipped. Imports upsert by natural key, so importing the same file twice changes nothing. Importing needs permission to manage integrations.

### Indexing

Each project can have an IndexNow key. OpenSEO generates one (32 hex characters) or imports a key the site already publishes, and never replaces it on its own, because the published key file would stop matching. OpenSEO verifies the key by fetching the key file through the same SSRF-safe probe it uses for other user-supplied URLs and checking that it holds exactly the key. It does not follow redirects, since IndexNow reads the key file at its URL; the one exception is a redirect to the same path on the site's other www/apex host, where the site's URLs, and so IndexNow's reads, end up.

URLs go out on one of two channels. `auto` uses IndexNow once the key is verified, and otherwise Bing's URL submission API when the project has a Bing connection. Callers can force either channel. Before sending, OpenSEO keeps only http(s) URLs on the project's site (www and the apex count as one site) and skips URLs announced successfully within the project's dedupe window (24 hours by default) unless the caller forces a resend. Bing's API sends at most the remaining daily and monthly quota and marks the rest as skipped. If IndexNow answers that it cannot validate the key, OpenSEO clears the verification so `auto` falls back to Bing until the key file is fixed and verified again. An archived project sends nothing on any path.

Every URL gets a ledger row per announcement: channel, source (manual, MCP, sitemap, deploy hook or audit), status and HTTP status. `received` and `pending` mean the engine got the notice; they never mean the page is indexed.

URLs reach the ledger from four automatic or manual paths:

- **Sitemap watch.** OpenSEO keeps an inventory of every URL the project's sitemaps list, with its `<lastmod>`. The sitemaps are the project's tracked ones (spec 0017), or robots.txt and `/sitemap.xml` while none are tracked. A daily check, for projects with auto-submit on, submits URLs that are new and up to 500 URLs whose `<lastmod>` moved forward; the rest stay changed for the next check. Removed URLs are recorded, not announced. The first inventory is a baseline that records everything and submits nothing. A URL's inventory entry only moves forward once its announcement got an answer that resending would not change: a failed, throttled or over-quota send, one IndexNow refused because it could not read the key file, or one with no channel set up leaves the URL new or changed, so a later check sends it again. When at least ten URLs carry a `<lastmod>` in both inventories and nine in ten of them moved to within 36 hours of the check, the sitemap is stamping its generation time rather than content changes; that check sends only new URLs and the Indexing page says why. The walk reads sitemap documents in sitemap order, so a URL or document cap always cuts the same URLs, and the URLs past a cap are not counted as removed. A read in which any sitemap document failed (timeout, network error, 429 or 5xx) records and sends nothing, because the URLs of a missed document would look removed now and new again later; the next check reads everything again. Any indexing setup starts the watch: connecting a Bing site, generating or importing an IndexNow key, or saving indexing settings.
- **Deploy hook.** `POST /api/indexing/hook/{projectId}`, authenticated with a per-project bearer secret. OpenSEO shows the secret once and stores only its SHA-256; rotating it invalidates the old one. An unknown project and a wrong secret get the same 401. With a `urls` list in the body (at most 2,000, in a body of at most 64 KB) those URLs are submitted; with no list, the hook runs the sitemap check. The dedupe window makes a repeated deploy a no-op.
- **After a site audit.** When an audit completes, pages that both it and the previous completed audit of the same origin crawled, and whose content hash changed between them (indexable 200s only), are submitted over IndexNow, if auto-submit is on and the key is verified. Pages only the new audit reached are not submitted: two crawls rarely cover the same pages, so a page missing from the earlier crawl is not evidence that it is new. New pages come from the sitemap watch. The first audit of a site is a baseline. `compare_audits` reports content-changed pages as `pages.changed`, without the indexable-200 filter.
- **Manual and MCP.** Users paste URLs on the Indexing page, and agents call `submit_urls_for_indexing`.

### In the app

The connection lives in a Bing Webmaster Tools card on the project's integrations settings, next to Search Console and Google Analytics. There a member saves or replaces their key, picks a site, pauses the daily sync, syncs on demand, or disconnects the project. Members who cannot manage integrations see the connection read-only.

Each project has a Bing Insights page that reads the stored history. A range picker (7, 28 or 90 days, 6 or 12 months) is anchored on the newest stored day, because Bing's data lags a few days, and every range is compared with the period before it. Clicks, impressions and CTR sit above a daily chart and six tabs:

- Queries and pages, sortable and filterable. Clicking a row opens a live drill-down from Bing for the same dates: the queries one page appeared for, or the pages that appeared for one query.
- Striking distance: queries whose average position is 5 to 20, with the same drill-down.
- Crawl health: Bingbot's daily crawl counts, the open and recently resolved crawl issues, and the sitemaps Bing knows.
- Backlinks: inbound link counts per page from the weekly snapshot. Clicking a page lists the pages linking to it, live from Bing.
- AI citations: the imported AI Performance data and the CSV import itself.

A project without a connection sees the connection card in place of the data.

### Site audits

When a project has a Bing connection, a site audit adds the crawl problems Bing reported in its last sync as three issue types: `bing-malware` (critical), `bing-crawl-error` (a 4xx or 5xx status, a timeout or a DNS failure when Bingbot fetched the URL) and `bing-blocked-by-robots`. They come from the stored crawl issues; the audit never calls Bing. An issue is attached to the audit's page when the crawl reached the same URL, and reported on the URL alone when it did not. Redirect-only rows are left out, an audit lists at most 500 of Bing's URLs, and a failure reading the snapshots leaves the Bing issues out without failing the audit.

Bing's Webmaster Guidelines can also be part of an audit's content evaluation; spec 0016 covers that.

### MCP tools

All are project-scoped through the shared MCP project auth, and expected failures (not connected, key rejected, site not readable, throttled) come back as `ok: false` with a reason and a link to the connection settings rather than as errors.

- Bing: `get_bing_overview`, `get_bing_search_performance` (by query, page or date over any stored range, with position and impression filters and a live drill-down), `get_bing_crawl_health`, `get_bing_backlinks`, `get_bing_keyword_stats`, `compare_search_engines` (Search Console and Bing side by side per query or page), `get_bing_ai_citations`, and `sync_bing_now`.
- Indexing: `get_indexing_setup`, `verify_indexnow_key`, `submit_urls_for_indexing`, `get_indexing_log`, and `get_indexing_candidates` (a live preview of what the sitemap watch would send, which records and sends nothing).

The tools that change state (`sync_bing_now`, `verify_indexnow_key`, `submit_urls_for_indexing`) require permission to manage integrations.

## Rationale

**API key rather than OAuth.** Bing Webmaster supports OAuth, but OAuth means registering an application with Microsoft and configuring client credentials and redirect URIs, which every self-hosted deployment would have to repeat. An API key is generated in two clicks inside Bing Webmaster Tools, belongs to the Bing account, and covers every site that account verified, the same shape as a Search Console grant. The cost is a long-lived, account-wide credential, which is why it is checked before storing, encrypted at rest, replaceable at any time, and never shown again.

**Daily snapshots rather than live reads.** Search Console is read live because Google serves sixteen months with arbitrary date ranges. Bing's fixed window and weekly buckets make live reads unable to compare periods reliably, and anything older than six months would be lost for good. Storing a daily copy gives users their own history and lets every read take a date range. The trade-off is that data is up to a day old unless someone syncs on demand.

**IndexNow first, Bing's API as fallback.** One IndexNow request reaches every participating engine, takes up to 10,000 URLs, and has no daily quota; Bing has said its URL submission API may give way to IndexNow. IndexNow needs a key file published on the site, though, and some users cannot publish one right away. Bing's API needs only the existing connection, so `auto` falls back to it, and both channels can be forced when diagnosing a problem.

**A sitemap baseline.** Submitting a whole sitemap the first time a site is connected would send thousands of URLs that engines already know, spend Bing's quota in a day, and resemble the kind of bulk submission engines discourage. Recording a baseline first means the watch only ever announces real changes.

**Distrusting volatile lastmods.** Sitemaps generated on request often stamp every URL with the current time, which would re-announce the whole site on every check. Ignoring `<lastmod>` altogether would miss real updates, and fetching every page to compare content would turn each check into a crawl. Detecting the pattern per check keeps `<lastmod>` useful for the many sites that set it properly, and still announces new URLs for those that don't.

**A per-project, hashed deploy hook secret.** A single deployment-wide secret would let one leaked CI variable announce URLs for every project, and it would not work for a hosted, multi-tenant deployment. A per-project secret limits a leak to one site and can be rotated without touching other projects. Storing only its hash means a database read does not reveal it, and answering an unknown project and a wrong secret identically means the endpoint cannot be used to discover project ids.

**IndexNow only after audits.** The audit engine runs isolated from the application's secrets because it parses untrusted HTML, so it cannot decrypt a Bing API key. An IndexNow key is not a secret (it is published on the site), so audits can use it. Projects that rely on Bing's API still get their new and changed pages through the daily sitemap check.

**Bing's crawl report inside the audit.** Bingbot can see a different site from OpenSEO's crawler: bot protection that lets one through may block the other, and a `bingbot` group in robots.txt replaces the `*` group for Bing. Adding Bing's report to the audit puts both views in one issue list that `compare_audits` tracks across audits. Reading the snapshot keeps the audit away from the Bing key (see "IndexNow only after audits") and from Bing's rate limits; the cost is that the issues are as old as the last sync.

**A Bing page beside Search Console's rather than one merged view.** Bing's query and page figures are weekly buckets with no device or country split, so a merged table would mix granularities that do not line up. Each engine gets its own page with the same layout, and `compare_search_engines` sets the two side by side for agents, matched per query or page.

**AI Performance by CSV.** Bing has no API for AI citations. Importing the export now gives users the data and a place to keep its history; an API can replace the import if Bing ships one.

## Consequences

- Stored history starts with the first sync (which holds Bing's current window) and grows from there; it cannot recover months Bing had already dropped before the project was connected.
- Bing data in OpenSEO is up to a day old. Deployments that run no scheduled jobs depend on syncing Bing on demand, and on the deploy hook for sitemap checks.
- Bing reports no device or country split. Query and page figures are weekly buckets, and positions are impression-weighted averages over the weeks in a range, so they do not line up exactly with Search Console's daily figures.
- Some Bing methods answer unreliably: the crawl-issue list is often empty even when problems exist, and keyword statistics are marked experimental in their tool description.
- Bing takes an API key only in the request URL, so with Workers traces on, the deploying Cloudflare account's traces can hold saved keys in plain text; the self-hosting guide says how to turn traces down and rotate a key.
- Rotating `BETTER_AUTH_SECRET` makes saved Bing keys unreadable; affected users save their key again, and the projects they connected resume syncing on the next scheduled run.
- The indexing ledger records announcements, not indexing. Google is not reached by either channel; Search Console and URL inspection remain the tools for Google.
- Bing issues in a site audit are as fresh as the last Bing sync. On deployments without scheduled jobs that is the last on-demand sync.
- New Bing capabilities should extend the Bing services and read from the stored history where Bing's API allows, keeping reads free and project-scoped.
