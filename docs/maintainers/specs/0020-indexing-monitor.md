# Google indexing monitor

## Status

Accepted

## Context

Sites that publish many pages from a template (job postings, bulletins, listings, programmatic landing pages) need to know, day by day, which of them Google has indexed and why the others are not. Search Console answers that only page by page: its sitemap report's "indexed" count is no longer reliable, the page indexing report has no API, and the URL Inspection API answers one URL per call, within a quota of 2,000 calls a day and 600 a minute per property.

OpenSEO exposed the URL Inspection API only through `inspect_urls` (spec 0003), which inspected up to ten URLs one after the other and forgot the answers. An agent could sample a few pages, but nothing told a user that a page published last week was still "Discovered - currently not indexed", or that a page indexed last month had dropped out.

## Decision

Each project with a Search Console property gets an indexing monitor: OpenSEO keeps the list of URLs the project's sitemaps publish, inspects them with the URL Inspection API on a schedule within Google's quota, stores each URL's latest result and a history of its changes, and reports the result per coverage state, per URL template, over time, and as a list of problems. Like the rest of Search Console, it is free: no credits are metered.

### Which URLs

Once a day, the monitor reads the project's tracked sitemaps (spec 0017), or robots.txt and `/sitemap.xml` while none are tracked, through the same SSRF-safe sitemap walk the sitemap watch uses (spec 0015). It keeps the URLs inside the Search Console property (a domain property accepts the domain and its subdomains; a URL-prefix property only URLs under its prefix), up to 10,000 per project, and records which tracked sitemap led to each. URLs that left the sitemaps stop being monitored, and stop counting in the reports, but keep their rows and history, so a URL that comes back picks up where it left off. A read in which a sitemap document failed adds what it found and marks nothing as gone, since the URLs of the missed document would otherwise look removed.

### When each URL is inspected

The five-minute cron claims due projects with a compare-and-set on their next run time, like the Bing sync, and leases each claim for half an hour so a run that dies is retried. A run inspects up to 100 URLs, five at a time, and a tick stops starting new runs after two minutes. URLs are picked in priority order:

1. URLs never inspected, oldest first.
2. URLs not indexed, last inspected over a day ago.
3. Indexed URLs, last inspected over a week ago.

Each project spends at most 1,500 inspections per UTC day, leaving a quarter of Google's quota for manual inspections from the app and agents, which count against the same daily figure. A run that fills its batch is due again at the next tick; one that finds nothing due looks again six hours later; one that hits the daily budget resumes the next UTC day. A Search Console rate-limit answer stops the batch (the URLs not sent yet are skipped) and pauses the project for an hour. An expired or revoked grant, or a batch Google refused entirely, pauses the project for a day and asks the user to reconnect.

At 1,500 a day and a weekly recheck of indexed pages, a property can keep about 10,000 URLs current, which is where the per-project cap comes from.

### What is stored

Per URL: whether it is in the sitemaps now and which sitemap listed it, Google's verdict, coverage state, indexing state (noindex), robots.txt state, page fetch state, last crawl time, Google's and the page's canonical, when OpenSEO first saw it, when it was last inspected, when it was first seen indexed, and why the last call failed when it did. A failed call keeps the URL's last known state.

A history row is written only when a URL's coverage state, Google's canonical or its indexed verdict changes (and on its first answer), with the verdict before the change. That keeps the history small, since most rechecks change nothing, while still allowing the daily trend to be rebuilt: each change adds the URL to its new side and takes it off its old one, so a running sum over the days gives the indexed and not-indexed counts of every day.

Inspections made with `inspect_urls`, or with "Inspect now" in the app, go through the same path: they are stored for the monitor and counted against the daily budget. A URL inspected by hand that the sitemaps don't list is stored but not counted in the reports.

### Reports

The status read covers the monitored URLs:

- Totals: monitored, indexed, not indexed, not inspected yet; the day's inspections against the budget; the last run and any problem it hit.
- Counts per coverage state, and per URL template (the same template detection the site audit uses, so `/jobs/123` and `/jobs/456` count together).
- The daily trend of indexed and not-indexed URLs over the last 90 days.
- Problems, most serious first: dropped from the index (indexed once, not now), noindex, fetch errors (404, soft 404, 5xx, blocked by robots.txt, redirect errors), Google chose another canonical, still not indexed some days after first appearing in the sitemaps (seven by default), and URLs whose every inspection failed.

Filters by template, path prefix, indexed status, coverage state and problem kind narrow everything but the trend.

### In the app and over MCP

The Indexing page has a Google indexing section: totals, the trend chart, the per-template table and the problems table, each URL linking to its URL Inspection page in Search Console, with "Inspect now" to recheck one URL immediately.

`get_indexing_status` returns the same, with the trend bounded to the last 30 days by default and the problems list to 50 rows. `inspect_urls` now inspects five URLs at a time, stops sending after a rate-limit answer, and stores its answers for the monitor; it is how an agent rechecks specific URLs on demand.

The URL Inspection API accepts the `webmasters.readonly` scope OpenSEO already holds for every Search Console connection, so the monitor needs no new consent.

## Rationale

**Inspect the sitemaps' URLs rather than a sample.** The question users ask is "which of my pages are not indexed", and the pages that matter most to them are the new ones. Sampling would answer "about how many", and never which job posting from last Tuesday is missing. The sitemaps are the site's own list of pages it wants indexed, and the project already curates which sitemaps count.

**Priorities instead of a round robin.** A plain rotation through 10,000 URLs would take a week to notice a new page. New URLs first answer the daily question; not-indexed URLs are where change is likely and actionable; indexed pages rarely change state, and a weekly recheck still catches one that drops out.

**A budget below Google's quota.** The quota is per property and shared with anything else using it, including OpenSEO's own manual inspections and the user's other tools. Spending all 2,000 calls on the schedule would make "Inspect now" fail by the afternoon.

**Changes only, not every inspection.** Storing every answer would grow by up to 1,500 rows a day per project, almost all identical to the one before. The latest state lives on the URL's row; the history only needs the moments something changed, and the trend is rebuilt from them.

**Search Console's sitemap counts and page indexing report were not an option.** The sitemap "indexed" count reports zero for most properties now, and the page indexing report has no API. Search Analytics only knows pages that earned impressions, which says nothing about a page that has none because it is not indexed.

**The scheduled job, not a Workflow.** Each run is a bounded batch of independent, idempotent calls whose results are written as they arrive, and a run that dies loses at most one batch that the next claim repeats. A Workflow's durability would add little for that cost.

## Consequences

- Projects with Search Console connected start being inspected without any setup; nothing runs for projects without it.
- A property shared by several projects has one Google quota but a budget per project, so heavy use from several projects on the same property can hit Google's limit; the rate-limit pause covers that case.
- Sites with more than 10,000 sitemap URLs are monitored for the first 10,000 in sitemap order.
- The trend starts on the day of the first inspection; there is no backfill, since Google offers no history.
- The trend covers the URLs monitored now, so a URL that leaves the sitemaps leaves the trend on every day.
