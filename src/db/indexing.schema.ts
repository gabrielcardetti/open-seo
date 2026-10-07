import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import {
  GOOGLE_INDEXING_STATUSES,
  URL_SUBMISSION_CHANNELS,
  URL_SUBMISSION_SOURCES,
  URL_SUBMISSION_STATUSES,
} from "@/shared/indexing";
import {
  PROJECT_SITEMAP_SOURCES,
  PROJECT_SITEMAP_STATUSES,
} from "@/shared/sitemaps";
import { projects } from "./app.schema";

// ============================================================================
// Indexing: telling search engines about new and changed URLs (IndexNow and
// Bing's URL submission API), with a per-URL record of every announcement.
// ============================================================================

// One row per project that has indexing configured.
export const indexingSettings = sqliteTable("indexing_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Generated once or imported from an existing setup; never regenerated on
  // reconfigure, because a published key file would stop matching.
  indexnowKey: text("indexnow_key"),
  // Where the key file is served. Null means the default /{key}.txt at the
  // root of the project's origin.
  indexnowKeyLocation: text("indexnow_key_location"),
  indexnowVerifiedAt: text("indexnow_verified_at"),
  indexnowLastError: text("indexnow_last_error"),
  autoSubmitEnabled: integer("auto_submit_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  // A URL announced successfully within this many hours is not sent again.
  dedupeHours: integer("dedupe_hours").notNull().default(24),
  // SHA-256 of the deploy hook's bearer secret; the secret itself is shown
  // once and never stored.
  deployHookSecretHash: text("deploy_hook_secret_hash"),
  // Daily sitemap check, claimed with compare-and-set like the other crons.
  nextSitemapCheckAt: text("next_sitemap_check_at"),
  lastSitemapCheckAt: text("last_sitemap_check_at"),
  lastSitemapError: text("last_sitemap_error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// The ledger: one row per URL per announcement attempt outcome.
export const urlSubmissions = sqliteTable(
  "url_submissions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // Null for rows skipped before a channel was chosen.
    channel: text("channel", { enum: URL_SUBMISSION_CHANNELS }),
    source: text("source", { enum: URL_SUBMISSION_SOURCES }).notNull(),
    status: text("status", { enum: URL_SUBMISSION_STATUSES }).notNull(),
    httpStatus: integer("http_status"),
    errorMessage: text("error_message"),
    // Rows sent in the same request share a batch id.
    batchId: text("batch_id"),
    attempts: integer("attempts").notNull().default(1),
    // ISO-8601, always written by the service (the dedupe window compares it).
    submittedAt: text("submitted_at").notNull(),
  },
  (table) => [
    index("url_submissions_project_submitted_idx").on(
      table.projectId,
      table.submittedAt,
    ),
    index("url_submissions_project_url_idx").on(table.projectId, table.url),
  ],
);

// Every URL the project's sitemaps listed, with the lastmod they gave, so a
// daily check can tell new and changed URLs from ones already announced.
export const sitemapUrls = sqliteTable(
  "sitemap_urls",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    lastmod: text("lastmod"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    removedAt: text("removed_at"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.url] })],
);

// The project's own list of sitemaps. Detected ones (robots.txt, /sitemap.xml)
// start as suggestions the user confirms; tracked ones are what OpenSEO
// compares with Search Console and Bing, and what the sitemap watch reads.
export const projectSitemaps = sqliteTable(
  "project_sitemaps",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Absolute https URL, stored verbatim: engines match sitemaps byte for byte.
    url: text("url").notNull(),
    source: text("source", { enum: PROJECT_SITEMAP_SOURCES }).notNull(),
    status: text("status", { enum: PROJECT_SITEMAP_STATUSES }).notNull(),
    // ISO-8601, always written by the service.
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    confirmedAt: text("confirmed_at"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.url] })],
);

// A project's Google Indexing API service account and the health of its last
// check. The API only accepts pages with JobPosting or BroadcastEvent
// structured data; OpenSEO only checks the connection today, and a future
// submission channel for those pages reads the same row.
export const googleIndexingConnections = sqliteTable(
  "google_indexing_connections",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The whole service-account JSON, as ciphertext from secretBox. The
    // private key never leaves the server.
    serviceAccountEncrypted: text("service_account_encrypted").notNull(),
    // Copied from the JSON in clear, for display and the fix steps.
    clientEmail: text("client_email").notNull(),
    gcpProjectId: text("gcp_project_id"),
    // The URL the check reads metadata for; null means the domain's home page.
    sampleUrl: text("sample_url"),
    status: text("status", { enum: GOOGLE_INDEXING_STATUSES }).notNull(),
    // Google's own message when the last check failed.
    lastError: text("last_error"),
    lastCheckedAt: text("last_checked_at"),
    // When the status last changed: "working since" / "failing since".
    statusChangedAt: text("status_changed_at"),
    // Daily check, claimed with compare-and-set like the other crons.
    nextCheckAt: text("next_check_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
);
