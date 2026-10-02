# Sitemap registry

## Status

Accepted

## Context

Search engines learn about a site's sitemaps in two ways: from the `Sitemap:` lines in robots.txt, and from sitemaps registered in their webmaster tools. Search Console and Bing Webmaster Tools each keep their own list, and the lists drift: a sitemap added to the site never gets registered, a stale one (an old host, a retired section) stays registered for years. OpenSEO read both engines (spec 0003, spec 0015) but had no list of its own to compare them with, so it could not say which sitemaps were missing where. The sitemap watch (spec 0015) read whatever robots.txt named, and the Bing sync registered those with Bing, so a stray or foreign line in robots.txt was enough to send the wrong sitemap.

## Decision

Each project keeps a registry of its sitemaps. The tracked sitemaps in it are the source of truth that OpenSEO compares with Google and Bing, that the Bing sync registers, and that the sitemap watch reads.

### Detected and manual sitemaps

Every row has a URL (absolute https, stored verbatim because engines match sitemaps byte for byte), a source (detected or manual) and a status (suggested, tracked or ignored). A project holds at most 50 rows.

- **Detection** reads the site's robots.txt and checks its `/sitemap.xml`, on the project's real origin (validated, redirects followed). A robots.txt sitemap is suggested when it is an https URL on the project's site, where www and the apex count as one site; `/sitemap.xml` is suggested when it answers 200 with an XML sitemap. Detection only ever inserts new rows, so a sitemap the user already tracked or ignored keeps its status. It runs when a project with no rows first opens the Sitemaps card, when a Search Console property or a Bing site is connected, and on request.
- **Suggestions are confirmed by the user** (or by an agent after asking the user): tracking one makes it part of the comparison, ignoring one keeps it out and stops detection from suggesting it again.
- **Manual sitemaps** are tracked directly, once they pass the same checks: https, on the project's site, and a 200 XML answer through the SSRF-safe probe used for other user-supplied URLs. Redirects are not followed; the URL a sitemap redirects to is the one to add, because that is the URL engines should be given.
- **Removing** a manual sitemap forgets it; removing a detected one ignores it, so the next detection does not bring it back.

### Coverage

For each tracked sitemap, OpenSEO reports:

- **Google**: read live from `sitemaps.list` on the connected property: submitted or missing, pending, last submitted and downloaded, errors and warnings, and submitted and indexed URL counts. A URL-prefix property only accepts sitemaps under its prefix, so a tracked sitemap outside it is reported as such.
- **Bing**: from the last sync's GetFeeds snapshot: submitted or missing, Bing's status, URL count and last crawl. Bing data is up to a day old, like the rest of the Bing integration.

Sitemaps an engine lists that the registry does not hold at all are listed separately as unknown to OpenSEO (typically a stale sitemap), so the user can track or ignore them. Coverage also reports how many suggestions wait for review, how many tracked sitemaps each engine lacks, whether Search Console can accept submissions, and a short list of actions in plain language for the app and agents.

### Submitting

Users and agents with permission to manage integrations submit tracked sitemaps to Google (`sitemaps.submit`), Bing (SubmitFeed) or both, by default only the ones the engine does not list yet. Results are per engine and per sitemap. Google is never submitted to on a schedule. The daily Bing sync registers tracked sitemaps Bing does not list, up to five per sync, best-effort; it no longer submits whatever robots.txt names.

### Search Console write access

Reading Search Console needs the `webmasters.readonly` scope; submitting a sitemap needs `webmasters`. The Search Console connection now requests both. Grants made before that hold only the read-only scope: every read keeps working, and the scopes stored with the grant tell whether it can submit. When it cannot, the Search Console card, the Sitemaps card and the MCP tools ask the user to reconnect Search Console once with the Google account that connected the project. Requesting both scopes keeps reads working for a user who declines write access on Google's consent screen.

### In the app and over MCP

The Indexing page opens with a Sitemaps card: the tracked list with per-engine badges, suggestions with Track, Ignore and Track all, the sitemaps only an engine knows, ignored sitemaps, an add form, Detect again, and Submit missing to Google or Bing. On the integrations page, the Search Console and Bing cards warn when tracked sitemaps are missing there, or when suggestions wait for review and nothing is tracked.

Three MCP tools expose the same: `get_sitemaps` (registry, coverage and actions), `update_sitemaps` (track, ignore, add, remove, detect) and `submit_sitemaps` (Google, Bing or both, only the missing ones by default). The last two need permission to manage integrations. `get_project_context` lists `sitemaps` among the missing items while no sitemap is tracked, so an agent setting up a project is prompted to register them.

## Rationale

**Suggest, then confirm.** robots.txt is the best signal of which sitemaps a site has, but it is also where stale lines, sitemaps of another host and test sitemaps live. Tracking everything it names would compare engines against a list nobody checked, and the Bing sync would register those sitemaps with Bing on every site. Tracking nothing until the user types URLs would leave most projects empty. Detection proposes; one click confirms.

**Never re-suggest an ignored sitemap.** Detection runs again on every connection and on request. Without a remembered "no", every run would bring back the same stale sitemap and the review would never end.

**A registry rather than reading the engines.** Either engine's list could serve as the reference, but each is incomplete in its own way, and the point is to find where they disagree with the site. The user's own list is the only one that can be wrong in neither direction.

**No scheduled resubmission to Google.** Google reads registered sitemaps on its own schedule and discourages resubmitting ones it already knows. Submitting only on an explicit action, and by default only sitemaps Google does not list, keeps OpenSEO from becoming a resubmission loop. Bing has no such guidance, and its sync already runs daily, so registering missing tracked sitemaps there keeps Bing complete without a visit to Bing Webmaster Tools.

**Write scope with a reconnect, not a second connection.** A separate "Search Console (write)" connection would double the setup and the places a grant can expire. Asking for the write scope on the existing connection costs existing users one reconnect, and only when they want to submit.

## Consequences

- Existing Search Console connections can read but not submit until the connector reconnects. Self-hosted deployments must add the `webmasters` scope to their Google OAuth consent screen.
- A project with no tracked sitemaps behaves as before for the sitemap watch: robots.txt and `/sitemap.xml` are read. Once anything is tracked, only tracked sitemaps on the site's origin are read.
- The Bing sync no longer registers robots.txt sitemaps that nobody tracked.
- Google coverage is a live call to Search Console each time the registry is read; Bing coverage is as fresh as the last sync.
- Detection finds sitemaps only in robots.txt and at `/sitemap.xml`. Sitemaps elsewhere are added by hand, or tracked from the list of sitemaps an engine knows.
