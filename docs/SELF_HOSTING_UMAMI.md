# Umami analytics

If your site uses [Umami](https://umami.is) instead of Google Analytics,
connect it to a project to see organic visitors on the dashboard and to give
agents your landing pages, traffic sources, events, and search opportunities.
It is **optional** and uses no credits. OpenSEO reads Umami live, so nothing
is copied or synced.

Umami Cloud and self-hosted Umami both work.

## What you'll need

- `BETTER_AUTH_SECRET` set on your deployment, at least 32 characters. OpenSEO
  encrypts saved Umami credentials with it. If you already set it for Search
  Console or Bing, you're done. Otherwise generate one and restart:

  ```sh
  openssl rand -base64 32
  ```

  Set it in `.env` for Docker (then run
  `docker compose up -d --force-recreate open-seo`), in `.env.selfhost` on
  Cloudflare (then redeploy), or in `.env.local` for local development.

There are no other environment variables.

## Connect a project

Open the project's **Settings → Integrations** and find the **Umami** card.

- **Umami Cloud:** in Umami Cloud open **Settings → API keys**, create a key,
  and paste it.
- **Self-hosted:** enter the https address you open Umami at (for example
  `https://umami.example.com`), and a username and password. A view-only
  Umami user is enough, and safest. The address must be reachable from the
  internet: OpenSEO refuses private and internal network addresses, plain
  http, and redirects.

Then choose the website. The list includes your own websites and those of every
Umami team you belong to; the one matching the project's domain is suggested.

If one Umami website tracks more than one domain, connect it to each project:
OpenSEO counts only the pages on the project's own domain (and its `www.`
version) in every read.

## How it's used

- The dashboard's organic traffic card shows search-engine visitors from
  Umami when Google Analytics isn't connected.
- Agents read Umami with the `get_umami_*` MCP tools, and
  `get_search_opportunities` uses Umami when the project has no Google
  Analytics connection.

Organic search means visits referred by a search engine (Google, Bing,
DuckDuckGo, Yahoo, Yandex, Ecosia, Baidu, Brave). Dates are UTC days.
