import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organization, user } from "./better-auth-schema";
import { projects } from "./app.schema";

// ============================================================================
// Bing Webmaster Tools: a per-user API key, the verified site each project is
// connected to, and daily snapshots of everything the API lets us download.
// Bing only serves a fixed, rolling window (about six months) with no date
// range, so these rows are the history: each sync upserts by natural key and
// nothing is ever overwritten by an older window.
//
// Snapshot tables key on (project, site): the site is stored per row so that
// switching a project to another Bing site never mixes the two histories.
// ============================================================================

// One Bing Webmaster API key per OpenSEO user. A key belongs to the Bing
// account, not to a site, so it serves every site that account verified —
// the same shape as a Search Console grant.
export const bingApiKeys = sqliteTable("bing_api_keys", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  // Ciphertext from secretBox; the key never leaves the server.
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  // Last four characters, so the UI can say which key is saved.
  keyHint: text("key_hint").notNull(),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// The Bing site a project is connected to, and whose key reads it.
export const bingConnections = sqliteTable(
  "bing_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Stored verbatim from GetUserSites ("https://example.com/"). Bing matches
    // it byte-for-byte; never normalize.
    siteUrl: text("site_url").notNull(),
    connectedByUserId: text("connected_by_user_id").notNull(),
    syncEnabled: integer("sync_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    // Claimed with compare-and-set so two cron ticks never sync one project.
    nextSyncAt: text("next_sync_at"),
    lastSyncedAt: text("last_synced_at"),
    lastSyncError: text("last_sync_error"),
    // URL submission quota as of the last sync (GetUrlSubmissionQuota).
    dailyQuotaRemaining: integer("daily_quota_remaining"),
    monthlyQuotaRemaining: integer("monthly_quota_remaining"),
    quotaCheckedAt: text("quota_checked_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("bing_connections_project_idx").on(table.projectId),
    index("bing_connections_organization_idx").on(table.organizationId),
  ],
);

// Site-wide clicks and impressions per day (GetRankAndTrafficStats).
export const bingTrafficDaily = sqliteTable(
  "bing_traffic_daily",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    // YYYY-MM-DD, the Bing day bucket rendered in UTC.
    date: text("date").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.siteUrl, table.date] }),
  ],
);

// Query rows as Bing buckets them (weekly / sampled dates) — GetQueryStats.
// Kept per bucket; readers aggregate over a range.
export const bingQueryStats = sqliteTable(
  "bing_query_stats",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    periodDate: text("period_date").notNull(),
    query: text("query").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    // Null when Bing reports no clicks (it sends -1 or 0).
    avgClickPosition: real("avg_click_position"),
    avgImpressionPosition: real("avg_impression_position"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.siteUrl, table.periodDate, table.query],
    }),
  ],
);

// Page rows, same buckets as queries — GetPageStats.
export const bingPageStats = sqliteTable(
  "bing_page_stats",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    periodDate: text("period_date").notNull(),
    page: text("page").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    avgClickPosition: real("avg_click_position"),
    avgImpressionPosition: real("avg_impression_position"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.siteUrl, table.periodDate, table.page],
    }),
  ],
);

// Bingbot's crawl of the site per day — GetCrawlStats.
export const bingCrawlDaily = sqliteTable(
  "bing_crawl_daily",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    date: text("date").notNull(),
    crawledPages: integer("crawled_pages"),
    crawlErrors: integer("crawl_errors"),
    inIndex: integer("in_index"),
    inLinks: integer("in_links"),
    code2xx: integer("code_2xx"),
    code301: integer("code_301"),
    code302: integer("code_302"),
    code4xx: integer("code_4xx"),
    code5xx: integer("code_5xx"),
    allOtherCodes: integer("all_other_codes"),
    blockedByRobotsTxt: integer("blocked_by_robots_txt"),
    containsMalware: integer("contains_malware"),
    connectionTimeout: integer("connection_timeout"),
    dnsFailures: integer("dns_failures"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.siteUrl, table.date] }),
  ],
);

// URLs Bing reports crawl problems for — GetCrawlIssues. One row per URL with
// its lifetime: an issue that stops appearing is marked resolved, and comes
// back open if Bing reports it again.
export const bingCrawlIssues = sqliteTable(
  "bing_crawl_issues",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    url: text("url").notNull(),
    httpCode: integer("http_code"),
    // Bing's CrawlIssues bit flags, kept raw; decoded when read.
    issueFlags: integer("issue_flags").notNull(),
    inLinks: integer("in_links"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.siteUrl, table.url] }),
  ],
);

// Inbound link counts per page of the site, one snapshot per capture day —
// GetLinkCounts.
export const bingLinkCounts = sqliteTable(
  "bing_link_counts",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    capturedOn: text("captured_on").notNull(),
    url: text("url").notNull(),
    linkCount: integer("link_count").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.siteUrl, table.capturedOn, table.url],
    }),
  ],
);

// Sitemaps and feeds Bing knows for the site — GetFeeds.
export const bingSitemaps = sqliteTable(
  "bing_sitemaps",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    feedUrl: text("feed_url").notNull(),
    status: text("status"),
    urlCount: integer("url_count"),
    lastCrawledAt: text("last_crawled_at"),
    submittedAt: text("submitted_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.siteUrl, table.feedUrl] }),
  ],
);

// ----------------------------------------------------------------------------
// AI Performance (Copilot and Bing AI answer citations). Bing has no API for
// it yet, so these rows come from the report's CSV export. Imports upsert by
// natural key: re-importing the same file changes nothing.
// ----------------------------------------------------------------------------

export const bingAiCitationsDaily = sqliteTable(
  "bing_ai_citations_daily",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    citations: integer("citations").notNull(),
    citedPages: integer("cited_pages"),
    importedAt: text("imported_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.date] })],
);

// Citations per page over the export's period (a single day when the export
// is daily).
export const bingAiCitedPages = sqliteTable(
  "bing_ai_cited_pages",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    url: text("url").notNull(),
    citations: integer("citations").notNull(),
    importedAt: text("imported_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.periodStart, table.periodEnd, table.url],
    }),
  ],
);

// Grounding queries (Bing's sample of what the AI searched for) per period.
export const bingAiGroundingQueries = sqliteTable(
  "bing_ai_grounding_queries",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    query: text("query").notNull(),
    citations: integer("citations").notNull(),
    importedAt: text("imported_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({
      columns: [
        table.projectId,
        table.periodStart,
        table.periodEnd,
        table.query,
      ],
    }),
  ],
);

// One circuit breaker per upstream ("bing_api", "indexnow") for the whole
// deployment: the relay or network path in front of an upstream is shared by
// every project, so one outage pauses every caller. `state` is "closed" or
// "open"; an open breaker lets one call through as a probe once
// `nextProbeAt` passes (claimed with compare-and-set on that column).
export const upstreamBreakers = sqliteTable("upstream_breakers", {
  upstream: text("upstream").primaryKey(),
  state: text("state").notNull().default("closed"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  openedAt: text("opened_at"),
  nextProbeAt: text("next_probe_at"),
  lastError: text("last_error"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});
