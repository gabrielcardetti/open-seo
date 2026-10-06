# Core Web Vitals (Chrome UX Report and PageSpeed Insights)

Google ranks pages partly on Core Web Vitals measured from real Chrome users,
published in the [Chrome UX Report](https://developer.chrome.com/docs/crux)
(CrUX). With a Google Cloud API key, OpenSEO reads those numbers directly:

- **Dashboard:** a Core Web Vitals card with your site's mobile LCP, INP, CLS,
  FCP and TTFB at the 75th percentile, Google's pass/fail assessment, and the
  weekly trend over the last ~6 months.
- **Agents (MCP and SAM):** `get_core_web_vitals` returns the same data for
  your site, any page, or any other origin (a competitor, say), for mobile,
  desktop or all devices, with the weekly history. `run_pagespeed` runs
  PageSpeed Insights on one URL: Lighthouse scores, lab metrics, the biggest
  performance opportunities, and the field data beside them.

It is **optional** and uses no OpenSEO credits. Google's APIs are free within
their quotas (CrUX allows 150 queries a minute). Nothing is stored; CrUX
answers are cached for 12 hours because Google updates them daily.

Sites with little Chrome traffic have no CrUX data. Google publishes it only
for origins and pages with enough visits; PageSpeed Insights still works for
those (lab data only).

## Create the API key

1. Open the [Google Cloud console](https://console.cloud.google.com/) and pick
   or create a project. It can be the same project as your Search Console OAuth
   client.
2. Enable both APIs for the project:
   - [Chrome UX Report API](https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com)
   - [PageSpeed Insights API](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com)
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Edit the key and, under **API restrictions**, choose **Restrict key** and
   select only the Chrome UX Report API and the PageSpeed Insights API. Leave
   **Application restrictions** at **None**: OpenSEO calls Google from its
   server, so referrer or IP restrictions would block it.

## Set it on your deployment

Set `GOOGLE_API_KEY` to the key:

- **Docker:** add `GOOGLE_API_KEY=...` to `.env`, then run
  `docker compose up -d --force-recreate open-seo`.
- **Cloudflare:** add `GOOGLE_API_KEY=...` to `.env.selfhost` and redeploy. It
  is stored as a Worker secret.
- **Local development:** add it to `.env.local`.

The startup checks and `/api/health` report whether it is set.

## Troubleshooting

- **"Google returned an error (403)":** one of the two APIs isn't enabled for
  the key's project, or the key's API restrictions leave it out.
- **"Google returned an error (429)":** the per-minute quota was hit. Wait a
  minute.
- **"The Chrome UX Report has no data":** the origin or page doesn't have
  enough Chrome traffic. Try all devices instead of mobile, the origin instead
  of a page, or `run_pagespeed` for lab data.
