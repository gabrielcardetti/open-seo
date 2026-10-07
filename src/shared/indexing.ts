// Shared by the indexing schema, its service, the MCP tools and the UI.

export const URL_SUBMISSION_CHANNELS = ["indexnow", "bing_api"] as const;
export const URL_SUBMISSION_SOURCES = [
  "manual",
  "mcp",
  "sitemap",
  "deploy_hook",
  "audit",
] as const;
export const URL_SUBMISSION_STATUSES = [
  // IndexNow 200 / Bing API success.
  "received",
  // IndexNow 202: accepted, key validation pending.
  "pending",
  // 400/403/422: the engine refused it; resubmitting unchanged won't help.
  "rejected",
  // Network or 5xx after retries, or a Bing connection that needs fixing.
  "failed",
  // 429 after retries.
  "throttled",
  // Announced successfully within the project's dedupe window.
  "skipped_duplicate",
  // No Bing submission quota left and no verified IndexNow key.
  "skipped_quota",
] as const;

export type UrlSubmissionChannel = (typeof URL_SUBMISSION_CHANNELS)[number];
export type UrlSubmissionSource = (typeof URL_SUBMISSION_SOURCES)[number];
export type UrlSubmissionStatus = (typeof URL_SUBMISSION_STATUSES)[number];

// The indexing monitor's problems, most serious first.
export const INDEXING_PROBLEM_KINDS = [
  // Was indexed at some point and is not anymore.
  "lost_indexing",
  // Excluded by a noindex meta tag or X-Robots-Tag header.
  "noindex",
  // Googlebot could not fetch it (404, soft 404, 5xx, robots.txt, redirect).
  "fetch_error",
  // Google picked a different canonical than the page declares.
  "canonical_mismatch",
  // Still not indexed some days after it first appeared in the sitemaps.
  "not_indexed_after_days",
  // Every inspection so far failed (often: outside the property).
  "inspection_failed",
] as const;
export type IndexingProblemKind = (typeof INDEXING_PROBLEM_KINDS)[number];

export const INDEXING_URL_STATUSES = [
  "indexed",
  "not_indexed",
  "not_inspected",
] as const;

// The Google Indexing API connection's health, from its last check.
export const GOOGLE_INDEXING_STATUSES = [
  // A token was minted and Google accepted a metadata read for the sample URL.
  "ok",
  // No service account saved.
  "not_configured",
  // The token endpoint refused the key (revoked, deleted, or a skewed clock).
  "invalid_key",
  // The Indexing API is not enabled in the service account's Cloud project.
  "api_disabled",
  // The service account is not an owner of the Search Console property.
  "not_owner",
  // Google's 429: the project's quota is used up for now.
  "quota_exceeded",
  // Anything else; the stored error keeps Google's message.
  "error",
] as const;
export type GoogleIndexingStatus = (typeof GOOGLE_INDEXING_STATUSES)[number];
