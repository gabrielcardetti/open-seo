# Google Indexing API connection

## Status

Accepted

## Context

Google's Indexing API tells Google that a page was added, updated or removed, and gets it crawled within minutes instead of days. Google accepts it only for pages with `JobPosting` structured data, or `BroadcastEvent` embedded in a `VideoObject`; other uses may be ignored or treated as spam.

Sites that publish job postings already call it from their own backend. What they can't see is whether the setup still works. The API authenticates as a Google Cloud service account, and three things must hold at once: the key is valid, the Indexing API is enabled in the service account's Cloud project, and the service account is an owner of the Search Console property. When one of them breaks, the site's backend logs a 403 that nobody reads, and pages stop being crawled quickly. Google's own errors are terse: a token that works next to "Permission denied. Failed to verify the URL ownership." means the third condition, not the first.

## Decision

Each project can store one Google Indexing API service account. OpenSEO checks it on save, on demand, and once a day, sorts the outcome into a small status, and shows the reason and the exact fix in the app and over MCP. OpenSEO does not send notifications through the API yet.

### Storage

One row per project in `google_indexing_connections`: the whole service-account JSON as ciphertext (the same `BETTER_AUTH_SECRET`-derived encryption as Bing API keys and Google OAuth tokens), the service account's email and Cloud project id in clear for display and for the fix steps, an optional sample URL, the last status and Google's message, when it was last checked, when the status last changed, and when the next daily check is due. The row belongs to the project and is deleted with it.

The key is pasted as the JSON file Google Cloud downloads. It is validated before anything is stored: `type` must be `service_account`, and it must carry `client_email` and a PEM `private_key`. The private key is never returned to the client, written to logs or accepted through MCP.

A key Google refuses is still stored, with its status saying why, so the card always shows the current problem and the user replaces the key from there.

### The check

The check is read-only:

1. Sign a JWT for the service account with WebCrypto RS256 and exchange it at Google's token endpoint for an access token with the `indexing` scope. The token endpoint is fixed; the key file's own `token_uri` is ignored.
2. Read `urlNotifications/metadata` for the sample URL: the one the user chose, which must be on the project's site, or the home page of the project's domain.

The outcome is one of:

- `ok`: the metadata read succeeded, or answered 404, which only means Google has no notification for that URL yet.
- `not_configured`: no key saved.
- `invalid_key`: the token endpoint refused the key (deleted, disabled, revoked, or a skewed clock), with the token endpoint's message.
- `api_disabled`: a 403 saying the API has not been used in the project or is disabled (`SERVICE_DISABLED`). The fix links to the API's page in that Cloud project.
- `not_owner`: the 403 "Failed to verify the URL ownership". The fix names the exact email to add as an Owner in Search Console.
- `quota_exceeded`: a 429.
- `error`: anything else, including an unreachable Google, with Google's message.

Reasons and steps are built on the server from the status, the email, the Cloud project id and the sample URL, so the app and MCP say the same thing.

The daily check runs from the five-minute cron: due rows are claimed with a compare-and-set on their next check time, a day ahead, like the sitemap watch, and the job is isolated so its failure never stops the other jobs.

### In the app and over MCP

The Indexing page has a Google Indexing API card: the status badge, the reason and steps, since when it has been working or failing, the service account email with a copy button, the sample URL, and buttons to add, edit or remove the key and to check now. It says that the API is only for job-posting and livestream pages.

`get_indexing_setup` includes the connection (status, reason, steps, email, sample URL, times) and lists a failing connection in `actionNeeded`. `check_google_indexing` runs the check now. Changing the key or running the check needs the integration-management permission, like the Bing and IndexNow setup.

## Alternatives considered

**Sign in with Google (OAuth) instead of a service account.** The Indexing API accepts user tokens too, and OpenSEO already holds Search Console grants. But the API is meant for server-to-server use, sites already have a service account for it, and checking the user's grant would say nothing about the credentials the site's backend actually uses.

**Only check the token.** Minting a token proves the key is valid and nothing else; the production failure that motivated this feature had a working token. The metadata read is the cheapest call that exercises both the API enablement and the ownership check without sending a notification.

**Check with `urlNotifications:publish`.** It would test the full path but announces a URL to Google, counts against the publish quota, and is wrong for a page without job-posting markup.

**Store only the private key and email.** Keeping the whole JSON costs nothing and keeps the Cloud project id and any field a future caller needs.

**A Google client library.** The JWT bearer flow is a few lines of WebCrypto that run on Workers; the Google libraries assume Node.

## Consequences

- Projects with job postings can see when their Indexing API setup breaks, with the fix, without reading their own server logs.
- The check runs once a day per connected project and costs one token request and one metadata read; the metadata read counts against Google's read quota, not the publish quota.
- The storage is shaped for a future `google_indexing` submission channel: the same row supplies the credentials, and that channel would be restricted to URLs whose pages carry `JobPosting` or `BroadcastEvent` data, logging each notification in the existing submission ledger. Until then OpenSEO never publishes to the Indexing API.
