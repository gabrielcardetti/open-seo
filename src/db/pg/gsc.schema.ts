import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// See src/db/pg/app.schema.ts for why timestamps are ISO-8601 UTC text.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Connected Google Search Console property per project.
// OAuth tokens live in the better-auth `account` table under providerId
// "google-search-console"; this row only records which verified property maps
// to a project and whose grant to use when calling the GSC API.
export const gscConnections = pgTable(
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
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    // One selected property per project in v1; switching replaces the row.
    uniqueIndex("gsc_connections_project_idx").on(table.projectId),
    index("gsc_connections_organization_idx").on(table.organizationId),
  ],
);

// Indexing monitor: see src/db/gsc.schema.ts.
export const urlInspectionMonitors = pgTable("url_inspection_monitors", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  nextRunAt: text("next_run_at"),
  budgetDay: text("budget_day"),
  inspectionsToday: integer("inspections_today").notNull().default(0),
  urlsRefreshedAt: text("urls_refreshed_at"),
  lastRunAt: text("last_run_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const urlInspections = pgTable(
  "url_inspections",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    inSitemap: boolean("in_sitemap").notNull().default(false),
    sitemapUrl: text("sitemap_url"),
    verdict: text("verdict"),
    coverageState: text("coverage_state"),
    indexingState: text("indexing_state"),
    robotsTxtState: text("robots_txt_state"),
    pageFetchState: text("page_fetch_state"),
    lastCrawlTime: text("last_crawl_time"),
    googleCanonical: text("google_canonical"),
    userCanonical: text("user_canonical"),
    lastError: text("last_error"),
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

export const urlInspectionChanges = pgTable(
  "url_inspection_changes",
  {
    projectId: text("project_id").notNull(),
    url: text("url").notNull(),
    inspectedAt: text("inspected_at").notNull(),
    coverageState: text("coverage_state"),
    googleCanonical: text("google_canonical"),
    indexed: boolean("indexed").notNull(),
    previousIndexed: boolean("previous_indexed"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.url, table.inspectedAt] }),
    foreignKey({
      columns: [table.projectId, table.url],
      foreignColumns: [urlInspections.projectId, urlInspections.url],
    }).onDelete("cascade"),
  ],
);
