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
  // Network or 5xx after retries.
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
