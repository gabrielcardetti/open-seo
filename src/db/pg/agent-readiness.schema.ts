import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

// Timestamps are stored as *text* (same column shape as the SQLite schema); see
// the note in pg/app.schema.ts. `isoNow` matches `new Date().toISOString()`.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ============================================================================
// Agent readiness — mirror of ../agent-readiness.schema.ts
// ============================================================================

export const agentReadinessConfigs = pgTable("agent_readiness_configs", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  profile: text("profile", { enum: ["content", "apiApp"] })
    .notNull()
    .default("content"),
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
  nextRunAt: text("next_run_at"),
  lastSkipReason: text("last_skip_reason"),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

export const agentReadinessScans = pgTable(
  "agent_readiness_scans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    profile: text("profile", { enum: ["content", "apiApp"] }).notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    passed: integer("passed").notNull().default(0),
    applicable: integer("applicable").notNull().default(0),
    cloudflareStatus: text("cloudflare_status", {
      enum: ["ok", "error", "skipped"],
    })
      .notNull()
      .default("skipped"),
    cloudflareLevel: integer("cloudflare_level"),
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

export const agentReadinessChecks = pgTable(
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
