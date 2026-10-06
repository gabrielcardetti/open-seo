# Circuit breaker for Bing and IndexNow

## Status

Accepted

## Context

Bing's Webmaster API and IndexNow throttle the shared outbound IPs of Cloudflare Workers, so a deployment there can send both through a relay it runs itself (spec 0015, and the self-hosting guide). A relay is one more thing that can be down. A Cloudflare Tunnel in front of a relay answers `530` for as long as its connector is gone, and without special handling every call during that time failed one by one:

- each URL submission recorded a `failed` row per URL whose message blamed the engine ("IndexNow answered HTTP 530"), so the log read as though IndexNow had refused the site;
- the daily Bing sync tried every dataset, failed each one, and then waited a full day before trying again, even if the relay came back an hour later.

What failed was the path to the engine, not the engine's answer, and the two need different handling.

## Decision

OpenSEO keeps one circuit breaker per upstream: `bing_api` (every Bing Webmaster API call, including URL submission) and `indexnow`.

### What opens it

A transport failure opens the breaker: a timeout, a network error, a gateway status (`502`, `503`, `504`) or a Cloudflare origin status (`520` to `530`). One failure is enough; IndexNow requests already retry three times before giving up, and a wrongly opened breaker costs one short cooldown. Any other answer counts as the engine answering, including `4xx` (with `429` keeping its throttled handling) and other `5xx` statuses, and never opens it.

### State

A small table holds one row per upstream: state (closed or open), consecutive failures, when it opened, when the next probe may go out, and the last transport error. Workers isolates share no memory, so the breaker has to live in the database for every request and cron tick to see it.

The row is global for the deployment, not per project or organization. A relay serves every project of the deployment, and so does the network path to the engine when there is no relay; an outage seen by one project's call is an outage for all of them.

### While open

Calls short-circuit without touching the network, so an outage costs no requests and no waiting on timeouts.

- **Bing sync.** The first transport failure stops the rest of the run. The connection's last sync error becomes the outage ("The Bing relay is unreachable since …; retrying at …"), and the next sync is brought forward to the breaker's retry time instead of a day later.
- **URL submissions** (sitemap watch, deploy hook, manual, MCP). URLs that could not be sent get no ledger row. The submission result carries one problem in plain language, which the sitemap check stores as its last error and the manual and MCP paths return directly. The sitemap watch already leaves any URL without a settled answer as new or changed, so the next check sends it; that check is brought forward to the breaker's retry time.

Messages name the relay when the deployment routes that upstream through one ("The IndexNow relay is unreachable…"), and the engine otherwise.

### Recovery

When the cooldown runs out, the next real call is the probe. Claiming the probe is a compare-and-set on the next-probe time, which the claimer moves to the end of a short lease, so concurrent ticks and requests let exactly one call through. Any answer from the engine closes the breaker. Another transport failure re-opens it with the next cooldown: 15 minutes, then an hour, then every 6 hours. A probe whose caller dies before reporting lets another caller probe once its lease expires.

Deferred work needs no separate recovery step: the syncs and sitemap checks an outage touched are due at the retry time, so the first of them is the probe, and the rest follow on the next ticks once it succeeds.

### Surfacing it

The Bing page and the Indexing page show a notice while a breaker the project depends on is open. `get_bing_overview` and `get_sitemaps` return the outage as a field and as an `actionNeeded` line, and `get_indexing_setup` lists it.

## Rationale

**Distinguishing transport from the engine by status.** An engine's own `503` looks exactly like a gateway's, and only some relays add a header that would tell them apart. Both mean "stop calling for a while", so treating them the same keeps the rule a short status list. Engine answers that are not about reachability keep their existing meaning: a `403` from IndexNow still unverifies the key, and a `429` is still recorded as throttled.

**A persisted breaker rather than per-request retries.** Longer retry loops inside each call would multiply the requests sent to a dead relay and hold Workers requests open on timeouts, and a cron tick would still spend its budget failing. Persisting the state lets one failure pause every caller for the cooldown.

**No ledger rows for unsent URLs, rather than a new status.** A dedicated status would need a migration of the ledger's status set, a label in every view, and would still fill the log with one row per URL for one outage. Leaving those URLs out keeps the ledger a record of what engines answered, and the sitemap watch's existing rule (no settled answer means send again) already gives the resend guarantee.

**Bringing deferred work forward rather than closing hooks.** Rescheduling projects when a probe closes the breaker would need the closer to know which projects were deferred and would run inside whatever request happened to probe. Scheduling each deferred sync or check at the retry time keeps the cron's existing compare-and-set claims as the only scheduler.

## Consequences

- One flaky response from a gateway pauses that upstream for 15 minutes for the whole deployment.
- A breaker opened by one project's call also pauses interactive Bing calls (saving a key, live drill-downs) for other projects until the probe; they fail fast with the outage message.
- URLs submitted by hand or through the deploy hook's URL list during an outage are sent again only if the sitemap watch lists them as new or changed; otherwise the caller has to submit them again.
- Until a probe goes out, the notice can show a retry time that has already passed; the next call is the probe.
