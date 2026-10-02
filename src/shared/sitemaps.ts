// Shared by the sitemap registry schema, its services, the MCP tools and the UI.

/** How a sitemap reached the registry: found by detection, or added by hand. */
export const PROJECT_SITEMAP_SOURCES = ["detected", "manual"] as const;

/** Detected sitemaps start as suggestions; only tracked ones are compared
 *  with Google and Bing. An ignored sitemap is never suggested again. */
export const PROJECT_SITEMAP_STATUSES = [
  "suggested",
  "tracked",
  "ignored",
] as const;

export const SITEMAP_ENGINES = ["google", "bing"] as const;

/** Rows of every status a project's registry holds at most. */
export const MAX_PROJECT_SITEMAPS = 50;

export type ProjectSitemapSource = (typeof PROJECT_SITEMAP_SOURCES)[number];
export type ProjectSitemapStatus = (typeof PROJECT_SITEMAP_STATUSES)[number];
export type SitemapEngine = (typeof SITEMAP_ENGINES)[number];
