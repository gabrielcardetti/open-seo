/** Better Auth providerId for the incremental Google Search Console connection.
 *  Kept in `shared` so both server (auth config, GSC client) and client (connect
 *  button) can reference it without importing the server-only auth config. */
export const GSC_OAUTH_PROVIDER_ID = "google-search-console";

/** Write access to Search Console. OpenSEO needs it only to submit sitemaps
 *  (`sitemaps.submit`); every read works with the read-only scope. */
export const GSC_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";

// The read-only scope is requested alongside the write scope so that a user
// who declines write access on Google's consent screen still connects for
// reading. Grants made before the write scope was requested hold only the
// read-only one; they keep reading, and reconnecting once allows submitting.
export const GSC_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
  GSC_WRITE_SCOPE,
] as const;

export const GSC_SELF_HOSTED_SETUP_DOCS_URL =
  "https://github.com/every-app/open-seo/blob/main/docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md";
