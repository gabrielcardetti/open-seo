import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// Connected Google Search Console property per project.
// OAuth tokens live in the better-auth `account` table under providerId
// "google-search-console"; this row only records which verified property maps
// to a project and whose grant to use when calling the GSC API.
export const gscConnections = sqliteTable(
  "gsc_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Stored verbatim from sites.list — "sc-domain:example.com" or
    // "https://example.com/". Never normalize; GSC matches it byte-for-byte.
    siteUrl: text("site_url").notNull(),
    // Whose google-search-console grant getAccessToken should use.
    connectedByUserId: text("connected_by_user_id").notNull(),
    gscAccountId: text("gsc_account_id"),
    connectedAccountEmail: text("connected_account_email"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    // One selected property per project in v1; switching replaces the row.
    uniqueIndex("gsc_connections_project_idx").on(table.projectId),
    index("gsc_connections_organization_idx").on(table.organizationId),
  ],
);

// ============================================================================
// Indexing monitor: Google's URL Inspection results for the URLs a project's
// sitemaps list, refreshed on a schedule within Search Console's daily quota.
// ============================================================================

// Scheduling state per project: the compare-and-set claim and the URL
// inspections spent today against the property's daily quota.
export const urlInspectionMonitors = sqliteTable("url_inspection_monitors", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  nextRunAt: text("next_run_at"),
  // UTC day (YYYY-MM-DD) that inspectionsToday counts.
  budgetDay: text("budget_day"),
  inspectionsToday: integer("inspections_today").notNull().default(0),
  // Last time the URL list was read from the sitemaps.
  urlsRefreshedAt: text("urls_refreshed_at"),
  lastRunAt: text("last_run_at"),
  lastError: text("last_error"),
  // ISO-8601, always written by the service.
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// One row per monitored or manually inspected URL, with its latest inspection.
export const urlInspections = sqliteTable(
  "url_inspections",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // Listed in the project's sitemaps at the last read: the scheduler only
    // inspects these, and the summaries only count these.
    inSitemap: integer("in_sitemap", { mode: "boolean" })
      .notNull()
      .default(false),
    // The sitemap the walk that found it started from.
    sitemapUrl: text("sitemap_url"),
    verdict: text("verdict"),
    coverageState: text("coverage_state"),
    indexingState: text("indexing_state"),
    robotsTxtState: text("robots_txt_state"),
    pageFetchState: text("page_fetch_state"),
    lastCrawlTime: text("last_crawl_time"),
    googleCanonical: text("google_canonical"),
    userCanonical: text("user_canonical"),
    // Why the last inspection call failed; null when Google answered.
    lastError: text("last_error"),
    // ISO-8601, always written by the service.
    firstSeenAt: text("first_seen_at").notNull(),
    lastInspectedAt: text("last_inspected_at"),
    firstIndexedAt: text("first_indexed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.url] }),
    index("url_inspections_project_due_idx").on(
      table.projectId,
      table.inSitemap,
      table.lastInspectedAt,
    ),
  ],
);

// A URL's inspection history: a row only when its coverage state, Google's
// canonical or its indexed verdict changed, enough to rebuild daily trends.
export const urlInspectionChanges = sqliteTable(
  "url_inspection_changes",
  {
    projectId: text("project_id").notNull(),
    url: text("url").notNull(),
    inspectedAt: text("inspected_at").notNull(),
    coverageState: text("coverage_state"),
    googleCanonical: text("google_canonical"),
    indexed: integer("indexed", { mode: "boolean" }).notNull(),
    // Null on a URL's first row.
    previousIndexed: integer("previous_indexed", { mode: "boolean" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.url, table.inspectedAt] }),
    foreignKey({
      columns: [table.projectId, table.url],
      foreignColumns: [urlInspections.projectId, urlInspections.url],
    }).onDelete("cascade"),
  ],
);
