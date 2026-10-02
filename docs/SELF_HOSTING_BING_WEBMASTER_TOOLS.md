# Self-hosted Bing Webmaster Tools and IndexNow

Connecting Bing Webmaster Tools lets OpenSEO keep a daily history of your Bing
clicks, impressions, queries, pages, crawl health, and sitemaps. The Indexing
page announces new and changed URLs to Bing and the other IndexNow engines, and
records what each one answered.

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

In Bing Webmaster Tools, open **Settings → API Access → API Key** and generate
a key. The key belongs to your Bing account, so one key covers every site that
account has verified.

## 2) Connect a project

Open the project's **Integrations** page and find the Bing Webmaster Tools
section. Paste the API key: OpenSEO checks it with Bing before saving it, and
shows only its last four characters afterwards. Then pick the site to connect.
Only verified sites are listed, and the one matching the project's domain is
flagged.

Choosing the site, disconnecting, and syncing on demand need an organization
owner or admin.

## 3) Syncing

On Cloudflare deployments, a scheduled job syncs each connected project once a
day. The first sync stores the roughly six months of data Bing serves. After
that the history keeps growing, and OpenSEO keeps the days Bing drops. You can also sync
on demand from the app or with the `sync_bing_now` MCP tool, at most once every
ten minutes per project.

Docker deployments don't run scheduled jobs, so nothing syncs by itself, not
even the first sync after you pick a site. Sync on demand, and use the deploy hook (below) to check your sitemaps after each
deploy.

## 4) Set up IndexNow

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
  moved to a later date. The first check only records what's there and sends nothing. Like the
  sync, this check only runs on Cloudflare deployments; on Docker, use **Check
  and submit now** or the deploy hook.
- After a site audit, pages that are new or whose content changed since the
  previous audit are sent over IndexNow, once the key is verified.
- A URL sent successfully in the last 24 hours isn't sent again. Change the
  window with **Skip URLs sent in the last** on the same page.

## 5) Call the deploy hook from CI

On the Indexing page, create a deploy hook secret. It's shown once; store it
as a CI secret. Then call the hook after each deploy:

```sh
curl -X POST https://your-openseo-domain/api/indexing/hook/<projectId> \
  -H "Authorization: Bearer $OPENSEO_DEPLOY_HOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

With an empty body, OpenSEO checks your sitemaps and sends what's new or
changed. To send specific pages instead, pass them (up to 2,000 URLs in a body of at most 64 KB):

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
missing or shorter than 32 characters. Set it and restart (on Docker, recreate the
container).

**Bing rejected the API key**: the key was mistyped, regenerated, or revoked.
Generate a new one under **Settings → API Access** and save it again. Saving a
new key replaces the old one.

**The site isn't listed, or "the Bing account behind this API key can't read
this site"**: the site isn't verified in the Bing account that owns the key.
Verify it in Bing Webmaster Tools, or save a key from the account that did.

**Rate limit reached**: Bing throttles each key and each host. Wait and sync
again later. On Cloudflare, the next daily sync retries on its own.

**URLs come back `skipped_quota` (Over quota in the log)**: Bing's daily or
monthly URL submission quota is used up. Verify an IndexNow key to stop depending on it; IndexNow has no daily
quota.

**IndexNow answers `pending` or `rejected`**: `pending` means IndexNow is still
reading your key file; later submissions go through once it has. `rejected`
with a key error means the file is missing or doesn't contain exactly the key.
OpenSEO then marks the key unverified and uses Bing's API (if connected) until
you fix the file and verify again.

**Syncing stopped after changing `BETTER_AUTH_SECRET`**: keys encrypted with
the old secret can't be read. The member who connected the project saves their
API key again, and the projects they connected pick it up on the next sync.

**A URL shows `received` but isn't indexed**: `received` and `pending` only
mean the engine got the notice. Whether to index the page is the engine's call.
