# Umami analytics

## Status

Accepted

## Context

OpenSEO reads visitor behaviour from Google Analytics 4 (spec 0007): organic
landing pages, acquisition, events, and the search opportunities that join
Search Console pages with what visitors did after the click. Many sites don't
run Google Analytics. They use Umami, a privacy-focused analytics tool that is
either hosted by Umami (Umami Cloud) or self-hosted. Without GA4 those projects
had no analytics in OpenSEO at all.

Umami differs from GA4 in ways that shape the design:

- Two ways in. Umami Cloud authenticates every call with an API key header.
  A self-hosted instance has no API keys: a user logs in with a username and
  password and gets a bearer token.
- Ownership. A website belongs to a user or to a team the user is a member
  of. Teams are common, so a login often reaches its websites only through
  its teams.
- Full history, cheap reads. Umami answers any date range from its own
  database, with no sampling and no per-property quota.
- No channel filter. Umami reports traffic by channel (organic search,
  direct, referral, social, paid, email, AI assistants...) as a breakdown, but
  its filters don't include channel. Filters cover referrer domain, path, UTM
  fields, country, device and similar.
- Two API generations in the wild. Umami 3 names pages `path`, adds expanded
  metrics (visitors, visits, bounces and time per row) and returns stats as
  numbers plus a comparison period. Umami 2 names pages `url` and returns each
  stat as `{ value, prev }`.

## Decision

Add Umami as a second analytics source: a per-project connection, live reads,
`get_umami_*` MCP tools, and fallbacks wherever OpenSEO used GA4. Reads are
free: no credits are metered, as with Search Console and GA4.

### Connection

The connection belongs to the project, not to a user, because Umami
credentials are not tied to an OpenSEO identity the way a Google grant is. A
member with permission to manage integrations chooses Umami Cloud (an API key)
or a self-hosted instance (its address, a username and a password; a view-only
Umami user is recommended). OpenSEO checks the credentials by listing the
websites they can read and stores them only if Umami accepts them, encrypted
with the deployment's `BETTER_AUTH_SECRET`. Only the key's last four
characters, or the username, are ever shown back.

A self-hosted address must be https and must pass the same SSRF policy as a
site audit's start URL, DNS resolution included. Every call re-checks the
host, and redirects are never followed, so the instance can't bounce OpenSEO
to an internal address. Calls have a timeout and a response size cap. A
self-hosted client logs in once per request and logs in again, once, when
Umami answers 401 to a cached token.

The member then picks one website. Discovery covers the user's own websites
and those of every team they belong to: the website list with team access
included, plus each team's own website list, deduplicated. The picker groups
websites by owner and suggests the one whose domain matches the project's
(`www` and the apex count as one site). The team that owns the website is
stored with the connection; reads use the same website endpoints whoever owns
it, since Umami checks team access itself. Saving the same instance again (a
rotated password or key) keeps the chosen website if it is still listed.

When a read fails because Umami rejects the credentials or the website is
gone, the connection records the error so the integration card can say what
to fix; saving the connection again clears it.

### Live reads instead of snapshots

Umami keeps the full history and answers any range quickly, so OpenSEO stores
no copy. Every read is live: overview (visitors, visits, pageviews, bounce
rate, average visit time, views per visit, and a daily trend, against the
previous equal-length period), organic landing pages (entry pages), page
performance (paths), traffic acquisition (channels, referrer domains, UTM
source, medium and campaign), custom events, audience (country, device,
browser, operating system), and realtime visitors. Days are UTC. The default
range is the last 28 complete days.

Snapshots, as Bing needs them (spec 0015), would only add sync jobs, storage
and staleness without unlocking anything Umami can't answer directly.

### Organic search

Since Umami can't filter by channel, OpenSEO defines organic search the way
Umami's own `organicSearch` channel starts: a visit referred by a search
engine. For each read it asks Umami for the period's referrer domains, keeps
those whose host is a search engine's own (Google's country domains and app,
Bing, DuckDuckGo, Yahoo search, Yandex, Ecosia, Baidu, Brave, MSN), and sends
them as one referrer filter. Hosts are matched exactly rather than as
substrings, because Google's other services refer visits too:
accounts.google.com after a sign-in, notebook.google.com, the Gmail app. Reads
report the domains they used. This differs from Umami's channel in two small
ways: paid clicks that carry a search referrer count, and visits tagged only
with an organic UTM medium don't. The traffic acquisition read still shows
Umami's own channel breakdown, organic search included.

Deriving the channel per page instead (asking for the channel breakdown once
per page) would cost one Umami call per row and was rejected.

### Entry-page engagement

Umami 3 scores entry pages as single-view visits: every entry row comes back
with bounces equal to visits and no time on site. Entry pages therefore keep
their own visit counts but take bounce rate, visit time and views per visit
from the same page's path row, which describes the visits (in the same
filters) that viewed the page. Without this, every landing page read as a 100%
bounce and search opportunities lost their business-value signal.

### Choosing the source

Google Analytics keeps priority. Where OpenSEO used GA4 it now uses Umami when
the project has no GA4 connection but has an Umami website:

- `get_search_opportunities` joins Search Console pages ranking 4 to 20 with
  Umami's organic entry pages (by path, on the website's host) and scores them
  with the same formula and weights. Umami can't tie custom events to the page
  a visit entered on, so business value is the non-bounce rate, the
  counterpart of GA4's engagement-rate fallback. The answer says which source
  it used.
- The dashboard's organic traffic card shows Umami's search-referred visitors,
  visits, bounce rate and average visit time.
- When a GA4 tool finds no GA4 connection it points agents to the Umami tools.

### Umami-specific tools

Umami gets its own tools (`get_umami_overview`,
`get_umami_organic_landing_pages`, `get_umami_page_performance`,
`get_umami_traffic_acquisition`, `get_umami_events`,
`get_umami_audience_breakdown`, `get_umami_realtime`) instead of making the
GA4 tools source-agnostic. The two sources measure different things —
sessions, engagement, key events and revenue against visits, bounces, visit
time and custom events — so one schema would either hide what each source
means or fill half its fields with nulls, and agents would have to guess which
definition a number used. Separate tools keep each answer honest about its
source. Search opportunities is the exception because its output is a score
over a shared shape. The tools follow the GA4 tools' inputs (dates, channel,
limit, offset, previous-period comparison) and answer expected failures (not
connected, rejected credentials, a missing website, throttling) as `ok: false`
with a link to the integration settings.

**Reads keep to the project's site.** One Umami website often tracks several
hostnames: a sister domain sharing the tracking script, the logged-in app,
local development. Every read filters by the project's domain and its `www.`
twin (Umami's `hostname` filter), so a project's numbers and its search
opportunities only count its own pages. Realtime visitors can't be filtered by
host and cover the whole website.

## Consequences

- Projects on Umami get organic analytics, search opportunities and agent
  access without Google Analytics.
- Every read calls the Umami instance, so a slow or unreachable instance slows
  or fails that read; nothing is cached.
- Organic numbers can differ slightly from Umami's own organic search channel,
  for the reasons above.
- The client accepts both Umami 2 and Umami 3 answers; instances older than
  Umami 3 return only a single count per row for breakdowns.
