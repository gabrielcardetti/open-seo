---
title: "Self-Hosting OpenSEO"
description: "Run OpenSEO yourself with Docker or Cloudflare, bring your own DataForSEO API key, and pay only for what you use."
---

OpenSEO is free and open source. Self-hosting means the app costs $0. You bring your own DataForSEO API key and pay DataForSEO directly for API usage.

There are two self-hosting paths:

- **Simple: [Docker](/docs/self-hosting/docker)**, recommended for personal use on your own machine. Easiest way to get started.
- **Advanced: [Cloudflare](/docs/self-hosting/cloudflare)**, for internet-facing self-hosting across multiple devices or with your team. A SaaS-like experience with automatic database backups, and it works on Cloudflare's free plan. Slightly more setup if you're unfamiliar with Cloudflare.

## DataForSEO API key setup

OpenSEO uses [DataForSEO](https://dataforseo.com/?aff=255379) to fetch SEO data. DataForSEO is a paid third-party service unaffiliated with OpenSEO. You need an API key to connect OpenSEO to it.

1. Go to [DataForSEO API Access](https://app.dataforseo.com/api-access?aff=255379).
2. Click "Send by email" to get your credentials.
3. Copy the longer credentials labelled "Base64" credentials.
4. Set this as `DATAFORSEO_API_KEY` in your environment:
   - Docker: `.env`
   - Cloudflare: as a Worker secret in the dashboard
   - Local development: `.env.local`

New DataForSEO accounts include $1 of free credit to test with, and the minimum top-up is $50. See [pricing](/pricing) for cost estimates. Self-hosted costs run slightly lower, since the hosted service adds a 28% fee on DataForSEO requests.

## Optional features

### Google Search Console

Search Console is optional and works in self-hosted deployments using your own Google OAuth client. It takes about 10 minutes of one-time setup. See the [Google Search Console guide on GitHub](https://github.com/every-app/open-seo/blob/main/docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md).

### Bing Webmaster Tools and IndexNow

Bing Webmaster Tools and IndexNow are optional. Paste a Bing Webmaster API key to keep a history of your Bing traffic and crawl health on the Bing Insights page. Site audits then also list the crawl problems Bing found. Publish an IndexNow key file to announce new and changed pages to Bing and other IndexNow engines. Saved API keys are encrypted with `BETTER_AUTH_SECRET`, the only environment variable this needs. Daily syncs and sitemap checks run only on Cloudflare deployments; on Docker you sync on demand. See the [Bing Webmaster Tools guide on GitHub](https://github.com/gabrielcardetti/open-seo/blob/main/docs/SELF_HOSTING_BING_WEBMASTER_TOOLS.md).

### Google Indexing API

If your site publishes job postings and its backend notifies Google through the Indexing API, paste the service account's JSON key on the Indexing page. OpenSEO checks every day that the key works, the API is enabled, and the service account owns your Search Console property, and tells you exactly what to fix when one of them breaks. It does not send notifications itself. The key is encrypted with `BETTER_AUTH_SECRET`. See the [Google Indexing API guide on GitHub](https://github.com/gabrielcardetti/open-seo/blob/main/docs/GOOGLE_INDEXING_API.md).

### Umami analytics

If your site uses Umami instead of Google Analytics, connect Umami Cloud (an API key) or your self-hosted Umami (its address and a view-only login) to see organic visitors on the dashboard and give agents your landing pages, traffic sources, and events. It reads Umami live and uses no credits. Saved credentials are encrypted with `BETTER_AUTH_SECRET`. See the [Umami guide on GitHub](https://github.com/gabrielcardetti/open-seo/blob/main/docs/SELF_HOSTING_UMAMI.md).

### Core Web Vitals

Set `GOOGLE_API_KEY` to a Google Cloud API key with the Chrome UX Report API and PageSpeed Insights API enabled to see your site's Core Web Vitals as Google measures them from real Chrome users, with a weekly trend, on the dashboard. Agents can also read them for any page or competitor and run PageSpeed Insights. It uses no credits. See the [Core Web Vitals guide on GitHub](https://github.com/gabrielcardetti/open-seo/blob/main/docs/SELF_HOSTING_GOOGLE_CORE_WEB_VITALS.md).

### AI features (SAM)

AI features like SAM, the in-app SEO agent, are optional. Set the `OPENROUTER_API_KEY` environment variable to enable them. Create a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
