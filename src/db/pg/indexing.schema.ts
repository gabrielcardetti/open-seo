import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  primaryKey,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import {
  URL_SUBMISSION_CHANNELS,
  URL_SUBMISSION_SOURCES,
  URL_SUBMISSION_STATUSES,
} from "@/shared/indexing";
import { projects } from "./app.schema";

// See src/db/pg/app.schema.ts for why timestamps are ISO-8601 UTC text.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ============================================================================
// Indexing: telling search engines about new and changed URLs (IndexNow and
// Bing's URL submission API), with a per-URL record of every announcement.
// ============================================================================

// One row per project that has indexing configured.
export const indexingSettings = pgTable("indexing_settings", {
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
  autoSubmitEnabled: boolean("auto_submit_enabled").notNull().default(true),
  // A URL announced successfully within this many hours is not sent again.
  dedupeHours: integer("dedupe_hours").notNull().default(24),
  // SHA-256 of the deploy hook's bearer secret; the secret itself is shown
  // once and never stored.
  deployHookSecretHash: text("deploy_hook_secret_hash"),
  // Daily sitemap check, claimed with compare-and-set like the other crons.
  nextSitemapCheckAt: text("next_sitemap_check_at"),
  lastSitemapCheckAt: text("last_sitemap_check_at"),
  lastSitemapError: text("last_sitemap_error"),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

// The ledger: one row per URL per announcement attempt outcome.
export const urlSubmissions = pgTable(
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
export const sitemapUrls = pgTable(
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
