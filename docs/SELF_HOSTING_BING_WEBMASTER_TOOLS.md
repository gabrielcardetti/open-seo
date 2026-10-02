# Self-hosted Bing Webmaster Tools and IndexNow

Connecting Bing Webmaster Tools lets OpenSEO keep a daily history of your Bing
clicks, impressions, queries, pages, crawl health, and sitemaps, which you read
on the project's **Bing Insights** page. Site audits then also report the crawl
problems Bing found. The Indexing page announces new and changed URLs to Bing
and the other IndexNow engines, and records what each one answered.

Both are **optional** and use no credits: Bing and IndexNow don't charge for
these calls. Google takes part in neither; use Search Console for Google.

## What you'll need

- A [Bing Webmaster Tools](https://www.bing.com/webmasters) account with your
  site added and verified. If the site is already in Google Search Console, Bing
  can import it from there.
- `BETTER_AUTH_SECRET` set on your deployment, at least 32 characters. OpenSEO
  encrypts saved Bing API keys with it. If you already set it for Search
  Console, you're done. Otherwise generate one and restart:

  ```sh
  openssl rand -base64 32
  ```

  Set it in `.env` for Docker (then run
  `docker compose up -d --force-recreate open-seo`), in `.env.selfhost` on
  Cloudflare (then redeploy), or in `.env.local` for local development.

There are no other environment variables. IndexNow on its own needs no Bing
account and no secret, only a key file on your site.

## 1) Create a Bing Webmaster API key

In Bing Webmaster Tools, open **Settings → API Access → API Key** and choose
**Generate API Key**. The key belongs to your Bing account, so one key covers
every site that account has verified.

### On Cloudflare Workers: route Bing calls through a relay

Bing throttles requests by IP address, and Cloudflare Workers share their
outbound IPs with every other Worker. From a Worker, Bing often answers every
call with `ThrottleIP`, even with a valid key, and saving the key fails with
"Bing is rate-limiting this server's IP address". Docker deployments call Bing
from their own IP and don't need this.

The fix is a small relay on any machine with its own IP that forwards
`/webmaster/api.svc/*` to `https://ssl.bing.com` and only accepts requests that
carry a shared secret in an `X-Relay-Secret` header (the relay should drop that
header before forwarding). Then set:

```bash
BING_API_BASE_URL=https://your-relay.example.com
BING_RELAY_SECRET=a-long-random-secret
```

and redeploy. A minimal Caddy configuration:

```caddyfile
:8080 {
	@api {
		path /webmaster/api.svc/*
		header X-Relay-Secret {$RELAY_SECRET}
	}
	handle @api {
		request_header -X-Relay-Secret
		reverse_proxy https://ssl.bing.com {
			header_up Host ssl.bing.com
		}
	}
	handle {
		respond 404
	}
}
```

The API key travels in the request's query string, so serve the relay over
HTTPS and keep its access logs free of query strings.

## 2) Connect a project

Open the project's **Settings → Integrations** page and find the **Bing
Webmaster Tools** card. (Until the project is connected, **Bing Insights** in
the sidebar shows the same card.) Paste the key into **Bing Webmaster API key**
and click **Save key**. OpenSEO checks it with Bing before saving it, and shows
only its last four characters afterwards.

Then pick the site under **Choose the Bing site** and click **Connect site**.
Only sites verified in that Bing account are listed. The one matching the
project's domain is marked **Matches this project** and selected for you.

OpenSEO saves the key to your account, not to the project, and the projects you
connect sync with it. **Replace** swaps it for a new one; **Remove** deletes
it, and the projects you connected stop syncing until someone reconnects them.

Connecting, changing the site, pausing the sync, syncing on demand, and
disconnecting need an organization owner or admin. Other members see the
connection and can read the data.

### Security note

Bing accepts an API key only as an `apikey` parameter in the request URL
(its other option is OAuth, which OpenSEO doesn't use). OpenSEO's
`wrangler.jsonc` turns on Workers traces, and a trace records the full URL of
each outgoing request, so on Cloudflare the traces of the account you deploy
to can contain your Bing API key in plain text. Anyone who can read that
account's Workers observability data can read the key.

To lower the exposure:

- Turn traces off, or sample fewer requests, under `observability.traces` in
  `wrangler.jsonc` (`"enabled": false`, or a `head_sampling_rate` below 1),
  then redeploy.
- Limit who has access to the Cloudflare account.
- If you think the key was seen, delete it in Bing Webmaster Tools under
  **Settings → API Access**, generate a new one, and save it in OpenSEO.

Docker deployments don't send traces to Cloudflare.

## 3) Syncing

On Cloudflare deployments, a scheduled job syncs each connected project once a
day. The first sync stores the roughly six months of data Bing serves. After
that the history keeps growing, and OpenSEO keeps the days Bing drops. To pause
the daily sync, turn off **Sync Bing data every day** on the Bing card.

Each sync also reads the site's `robots.txt` and registers with Bing any
sitemap listed there that Bing doesn't know yet, so a new sitemap reaches Bing
without a visit to Bing Webmaster Tools. Only sitemaps on the connected site
are sent, up to five per sync. Bing shows them as Pending until it crawls them.

You can also click **Sync now**, on the Bing card or the Bing Insights page, or
use the `sync_bing_now` MCP tool. A project can sync on demand at most once
every ten minutes.

Docker deployments don't run scheduled jobs, so nothing syncs by itself, not
even the first sync after you pick a site, although the app says it starts
within a few minutes. Click **Sync now** after connecting and whenever you want
fresh data, and use the deploy hook (below) to check your sitemaps after each
deploy.

## 4) Read your Bing data

Open **Bing Insights** in the project's sidebar. Pick a date range (from the
last 7 days to the last 12 months); each one is compared with the period
before it. Bing's data runs a few days behind, so ranges end on the newest day
OpenSEO has stored. Below the clicks, impressions, and CTR totals and a daily
chart are six tabs:

- **Queries** and **Pages**: click a row to see, live from Bing for the same
  dates, the queries that page appeared for or the pages that appeared for that
  query.
- **Striking distance**: queries whose average Bing position is 5 to 20.
- **Crawl health**: what Bingbot crawled each day, the URLs Bing reports
  problems with (open and recently resolved), and the sitemaps Bing knows.
- **Backlinks**: pages with the most links from other sites, as Bing counted
  them in the weekly snapshot. Click a page to list the pages linking to it,
  live from Bing.
- **AI citations**: how often Copilot and Bing's AI answers cite your site, from
  the AI Performance exports you import (next section).

Bing reports no device or country breakdown, and its query and page figures
come in weekly buckets, so they won't line up exactly with Search Console's.

## 5) Import AI Performance reports

Bing shows AI citations in Bing Webmaster Tools under **AI Performance**, but it
has no API for them, so OpenSEO can't sync them. Export the report as CSV
there, then on the **AI citations** tab choose the file under **CSV export**
and click **Import CSV**. OpenSEO reads three reports: citations per day, cited
pages, and grounding queries. It detects which one a file holds; pick it under
**Report** if it guesses wrong.

If an export has no date column, give the first and last day you exported in
**Period start** and **Period end**. Files can be up to 5 MB. Each import adds
to the history, and importing the same file twice changes nothing. Importing
needs an organization owner or admin.

## 6) Bing in site audits

Once Bing is connected, every site audit of the project also lists the crawl
problems Bing reported in its last sync, next to the issues OpenSEO's own crawl
found:

- **Bing flagged malware** (critical): Bing reports that the URL contains
  malware.
- **Bing can't crawl this URL**: Bingbot got a 4xx or 5xx status, a timeout, or
  a DNS failure. Bing can see a different answer than OpenSEO's crawler, for
  example when a firewall blocks Bingbot.
- **Blocked for Bingbot by robots.txt**: Bing reports that robots.txt stops
  Bingbot from crawling the URL. A `User-agent: bingbot` group replaces the `*`
  group for Bing, so check both.

The audit reads these from the last sync and never calls Bing. On Docker, sync
before you start the audit.

When you start an audit with **Evaluate content against Google's guidelines**
turned on, **Also check Bing's Webmaster Guidelines** adds Bing's rules:
robots.txt as Bingbot reads it, directives that keep a page out of Copilot
answers or limit how Copilot cites it, sitemap and redirect hygiene, content an AI answer can ground on, and
prompt injection. The audit's guidelines tab then shows Google's and Bing's
verdicts side by side. A Bing rule that contradicts Google's guidance only ever
warns. Bing's rules work without a Bing connection, except one that checks each
page against Bing's open crawl issues.

## 7) Set up IndexNow

On the project's **Indexing** page, generate a key, or import the key your site
already publishes. The project needs a website domain, and everything on this
page except reading it needs an organization owner or admin. Then publish the
key file:

- By default the file lives at `https://your-domain/<key>.txt`.
- It must contain the key and nothing else.
- If you serve it somewhere else, enter that location when importing the key.
  It must be an https URL on the project's domain, and IndexNow then accepts
  only URLs in that file's folder and below.

Click **Verify key file**. OpenSEO fetches the file the way IndexNow will. Once
it's verified, OpenSEO sends URLs through IndexNow. Until then, if Bing is
connected, it uses Bing's URL submission API, which has daily and monthly
quotas.

New and changed URLs are announced automatically. To stop it, turn off **Check
sitemaps daily and after audits** on the same page.

- A daily check of your sitemaps sends URLs that are new or whose `<lastmod>`
  moved to a later date. The first check only records what's there and sends
  nothing. If your sitemap gives every URL the current time as `<lastmod>`,
  only new URLs are sent and the Indexing page tells you. Like the
  sync, this check only runs on Cloudflare deployments; on Docker, use **Check
  and submit now** or the deploy hook.
- After a site audit, pages whose content changed since the previous audit
  are sent over IndexNow, once the key is verified. New pages come from the
  sitemap check, not from audits.
- A URL sent successfully in the last 24 hours isn't sent again. Change the
  window with **Skip URLs sent in the last** on the same page.

## 8) Call the deploy hook from CI

On the Indexing page, create a deploy hook secret. It's shown once; store it
as a CI secret. Then call the hook after each deploy:

```sh
curl -X POST https://your-openseo-domain/api/indexing/hook/<projectId> \
  -H "Authorization: Bearer $OPENSEO_DEPLOY_HOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

With an empty body, OpenSEO checks your sitemaps and sends what's new or
changed. To send specific pages instead, pass them (up to 2,000 URLs in a
body of at most 64 KB):

```json
{ "urls": ["https://example.com/new-page", "https://example.com/pricing"] }
```

The JSON response gives the channel used and a count per status. Calling the
hook twice in a row is safe because URLs sent recently are skipped. **Rotate
secret** on the Indexing page makes the old secret stop working.

Your CI has to reach OpenSEO for this to work. A Docker deployment that only
listens on `127.0.0.1` can't be called from a hosted CI runner.

### Behind Cloudflare Access

A Cloudflare self-hosted deployment sits behind Cloudflare Access, which sends
your CI's request to a sign-in page before OpenSEO sees it. Add a separate Access
application for the path `your-openseo-domain/api/indexing/hook` and give it
either:

- a **Bypass** policy. The hook still requires its own bearer secret.
- or a **Service Auth** policy with a service token. CI then also sends the
  token's `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

Use a separate application rather than editing the one OpenSEO's deploy
creates, because the deploy overwrites that application's policy.

## Troubleshooting

**Saving the key fails with a configuration error**: `BETTER_AUTH_SECRET` is
missing or shorter than 32 characters. Set it and restart (on Docker, recreate
the container).

**Bing rejected the API key**: the key was mistyped, regenerated, or revoked.
Generate a new one under **Settings → API Access** and save it again. Saving a
new key replaces the old one.

**The site isn't listed, or "the Bing account behind this API key can't read
this site"**: the site isn't verified in the Bing account that owns the key.
Verify it in Bing Webmaster Tools, or save a key from the account that did.

**"Bing is rate-limiting this server's IP address"**: Bing answered
`ThrottleIP`. On Cloudflare Workers this is the shared outbound IP, not your
key; set up the relay described in step 1.

**Rate limit reached**: Bing throttles each key and each host. Wait and sync
again later. On Cloudflare, the next daily sync retries on its own.

**URLs come back `skipped_quota` (Over quota in the log)**: Bing's daily or
monthly URL submission quota is used up. Verify an IndexNow key to stop
depending on it; IndexNow has no daily quota.

**IndexNow answers `pending` or `rejected`**: `pending` means IndexNow is still
reading your key file; later submissions go through once it has. `rejected`
with a key error means the file is missing or doesn't contain exactly the key.
OpenSEO then marks the key unverified and uses Bing's API (if connected) until
you fix the file and verify again.

**The Bing card says "Syncing has stopped"**: the member who connected the
project removed their API key. An owner or admin clicks **Reconnect**, saves
their own key if they haven't, and chooses the site again.

**Bing Insights is empty after connecting**: the first sync hasn't run yet. On
Docker it never runs by itself; click **Sync now**.

**"OpenSEO couldn't read this as an AI Performance export"**: OpenSEO needs a
Citations column plus a Date column (citations per day), a URL or Page column
(cited pages), or a Query column (grounding queries). The rest of the message
says which columns it expected. Check that you exported an AI Performance
report as CSV.

**Syncing stopped after changing `BETTER_AUTH_SECRET`**: keys encrypted with
the old secret can't be read. The member who connected the project saves their
API key again, and the projects they connected pick it up on the next sync.

**A URL shows `received` but isn't indexed**: `received` and `pending` only
mean the engine got the notice. Whether to index the page is the engine's call.
