# Google Indexing API

Google's [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart)
lets a site tell Google right away that a page was added, updated or removed.
OpenSEO keeps your service account key and checks, every day, that Google
accepts it, so you find out when something breaks before your pages stop
getting crawled.

OpenSEO does **not** send notifications through the API. Your site's own
backend does that when a page changes; OpenSEO only checks the connection.

It's **optional**, and only useful for one kind of site.

## Only for job postings and livestreams

Google accepts the Indexing API only for pages with
[`JobPosting`](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
structured data, or
[`BroadcastEvent`](https://developers.google.com/search/docs/appearance/structured-data/video)
embedded in a `VideoObject`. Google may ignore notifications for other pages,
and may treat that use as spam and revoke the project's access. For every other page, keep your sitemaps
up to date and let Google crawl them (OpenSEO's Indexing page helps with that).

## What you'll need

- A Google Cloud project you can manage.
- Owner access to the site's property in
  [Search Console](https://search.google.com/search-console).
- On self-hosted deployments, `BETTER_AUTH_SECRET` set (at least 32
  characters). It encrypts the saved key, as it does for Bing API keys.

## 1) Create a service account and a JSON key

1. In the [Google Cloud Console](https://console.cloud.google.com/), open
   **IAM & Admin → Service accounts** and click **Create service account**. It
   needs no roles.
2. Open the new service account, go to **Keys → Add key → Create new key**,
   pick **JSON**, and download the file.

Keep the file private: anyone holding it can act as the service account.

## 2) Enable the Indexing API

Enable the
[Web Search Indexing API](https://console.cloud.google.com/apis/library/indexing.googleapis.com)
in the **same** Cloud project as the service account. The change can take a
few minutes to reach Google's systems.

## 3) Make the service account an owner of the property

The Indexing API only acts on URLs of a property the service account owns.

1. In Search Console, open the property for your site.
2. Go to **Settings → Users and permissions → Add user**.
3. Enter the service account's email (the `client_email` in the JSON, ending
   in `.iam.gserviceaccount.com`) and choose **Owner**.

If you are a delegated owner yourself, use **Manage property owners → Add an
owner** instead.

## 4) Paste the key in OpenSEO

On the project's **Indexing** page, find the **Google Indexing API** card,
click **Add service account key**, and paste the whole JSON file. Optionally
pick a sample URL to check with, ideally one of your job postings; the default
is the home page of the project's domain. OpenSEO checks the connection as
soon as you save, once a day after that, and whenever you click **Check now**.
Organization owners and admins can change the key.

The check asks Google for an access token, then reads the notification
metadata for the sample URL. It sends nothing to Google's index.

## What the status means

| Status          | Meaning                                                                  | Fix                                                                   |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Working         | The key works, the API is enabled, and the service account owns the URL. | Nothing to do.                                                        |
| Invalid key     | Google's token endpoint refused the key: deleted, disabled, or revoked.  | Create a new JSON key (step 1) and paste it again.                    |
| API not enabled | The Indexing API is off in the service account's Cloud project.          | Enable it (step 2), wait a few minutes, then check again.             |
| Not an owner    | Google could not verify the service account owns the sample URL.         | Add its email as an Owner of the property (step 3).                   |
| Quota exceeded  | Google answered 429: the Cloud project's quota is used up for now.       | Wait for the daily reset (midnight Pacific Time), or ask for more.    |
| Check failed    | Anything else. The card shows Google's own message.                      | Check again in a few minutes; if it repeats, follow Google's message. |

The card also says since when the connection has been working or failing.

Agents read the same status, reason and fix steps with the
`get_indexing_setup` and `check_google_indexing` MCP tools. The key itself is
only ever pasted in the app.
