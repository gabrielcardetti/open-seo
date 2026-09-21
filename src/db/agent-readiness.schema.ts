import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";

// ============================================================================
// Agent readiness: how well a project's site can be discovered, read and used
// by AI agents, scanned by our own checks and by Cloudflare's, and tracked
// over time.
// ============================================================================

// One row per project that has agent readiness configured.
export const agentReadinessConfigs = sqliteTable("agent_readiness_configs", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Which checks apply: a content site is not judged on API standards.
  profile: text("profile", { enum: ["content", "apiApp"] })
    .notNull()
    .default("content"),
  scheduleEnabled: integer("schedule_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  // When the daily scan is next due; claimed with compare-and-set so two cron
  // ticks never run the same project.
  nextRunAt: text("next_run_at"),
  lastSkipReason: text("last_skip_reason"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// One row per scan.
export const agentReadinessScans = sqliteTable(
  "agent_readiness_scans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Stored per scan so a later change of the project's domain does not
    // rewrite history (same reason as backlink_snapshots.domain).
    origin: text("origin").notNull(),
    profile: text("profile", { enum: ["content", "apiApp"] }).notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    // Our engine: scored checks that passed, out of those that applied.
    passed: integer("passed").notNull().default(0),
    applicable: integer("applicable").notNull().default(0),
    // Cloudflare's engine, kept separate: the two are never averaged.
    cloudflareStatus: text("cloudflare_status", {
      enum: ["ok", "error", "skipped"],
    })
      .notNull()
      .default("skipped"),
    cloudflareLevel: integer("cloudflare_level"),
    // The scanner answers in markdown; kept so its parse can be audited.
    cloudflareRaw: text("cloudflare_raw"),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("agent_readiness_scans_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
  ],
);

// One row per check per engine per scan. The engines are compared by joining
// on check_id.
export const agentReadinessChecks = sqliteTable(
  "agent_readiness_checks",
  {
    id: text("id").primaryKey(),
    scanId: text("scan_id")
      .notNull()
      .references(() => agentReadinessScans.id, { onDelete: "cascade" }),
    engine: text("engine", { enum: ["openseo", "cloudflare"] }).notNull(),
    checkId: text("check_id").notNull(),
    category: text("category", {
      enum: ["discoverability", "content", "botAccess", "capabilities"],
    }).notNull(),
    status: text("status", {
      enum: ["pass", "fail", "not_applicable", "info", "error"],
    }).notNull(),
    message: text("message").notNull(),
    evidence: text("evidence"),
    fixUrl: text("fix_url"),
  },
  (table) => [index("agent_readiness_checks_scan_idx").on(table.scanId)],
);
