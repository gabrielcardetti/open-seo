import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { PAGE_FETCH_CLASSES } from "@/shared/audit-fetch-class";
import { projects } from "./app.schema";

// ============================================================================
// Site Audit tables
// ============================================================================

// One row per audit run
export const audits = sqliteTable(
  "audits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startedByUserId: text("started_by_user_id").notNull(),
    startUrl: text("start_url").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed"],
    })
      .notNull()
      .default("running"),
    workflowInstanceId: text("workflow_instance_id"),
    // JSON config: { maxPages, lighthouseStrategy }
    config: text("config").notNull().default("{}"),
    // Progress & summary
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    pagesTotal: integer("pages_total").notNull().default(0),
    lighthouseTotal: integer("lighthouse_total").notNull().default(0),
    lighthouseCompleted: integer("lighthouse_completed").notNull().default(0),
    lighthouseFailed: integer("lighthouse_failed").notNull().default(0),
    currentPhase: text("current_phase").default("discovery"),
    // Failure diagnostics; null unless status = "failed". errorCode is a
    // closed vocabulary (see classifyAuditError) so failures are aggregable;
    // errorDetail is the raw message, truncated. failedPhase records which
    // currentPhase the audit was in when it died.
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    failedPhase: text("failed_phase"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("audits_project_id_idx").on(table.projectId),
    index("audits_started_by_user_id_idx").on(table.startedByUserId),
  ],
);

// One row per crawled page
export const auditPages = sqliteTable(
  "audit_pages",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    statusCode: integer("status_code"),
    redirectUrl: text("redirect_url"),
    // Metadata
    title: text("title"),
    metaDescription: text("meta_description"),
    canonicalUrl: text("canonical_url"),
    robotsMeta: text("robots_meta"),
    // Open Graph
    ogTitle: text("og_title"),
    ogDescription: text("og_description"),
    ogImage: text("og_image"),
    // Headings
    h1Count: integer("h1_count").notNull().default(0),
    h2Count: integer("h2_count").notNull().default(0),
    h3Count: integer("h3_count").notNull().default(0),
    h4Count: integer("h4_count").notNull().default(0),
    h5Count: integer("h5_count").notNull().default(0),
    h6Count: integer("h6_count").notNull().default(0),
    headingOrderJson: text("heading_order_json"),
    // Content
    wordCount: integer("word_count").notNull().default(0),
    // Images
    imagesTotal: integer("images_total").notNull().default(0),
    imagesMissingAlt: integer("images_missing_alt").notNull().default(0),
    imagesJson: text("images_json"),
    // Links
    internalLinkCount: integer("internal_link_count").notNull().default(0),
    externalLinkCount: integer("external_link_count").notNull().default(0),
    // Structured data
    hasStructuredData: integer("has_structured_data", { mode: "boolean" })
      .notNull()
      .default(false),
    // Hreflang
    hreflangTagsJson: text("hreflang_tags_json"),
    // Indexability
    isIndexable: integer("is_indexable", { mode: "boolean" })
      .notNull()
      .default(true),
    // Indexability/canonical signals from response headers
    xRobotsTag: text("x_robots_tag"),
    headerCanonicalUrl: text("header_canonical_url"),
    // Crawl metadata
    // null depth = not reached via links (e.g. sitemap-seeded)
    crawlDepth: integer("crawl_depth"),
    inSitemap: integer("in_sitemap", { mode: "boolean" })
      .notNull()
      .default(false),
    // SHA-256 of the visible body text, for duplicate-content grouping
    contentHash: text("content_hash"),
    fetchClass: text("fetch_class", { enum: PAGE_FETCH_CLASSES })
      .notNull()
      .default("ok"),
    // Performance
    responseTimeMs: integer("response_time_ms"),
  },
  (table) => [index("audit_pages_audit_url_idx").on(table.auditId, table.url)],
);

// Link edges live in the per-audit AuditScratchpad Durable Object for the
// duration of the crawl; they are never persisted to the app DB.

// One row per (issue type, affected page)
export const auditIssues = sqliteTable(
  "audit_issues",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: text("page_id").references(() => auditPages.id, {
      onDelete: "cascade",
    }),
    pageUrl: text("page_url").notNull(),
    issueType: text("issue_type").notNull(),
    severity: text("severity", { enum: ["critical", "warning", "info"] })
      .notNull()
      .default("info"),
    // JSON details specific to the issue type (e.g. broken link target)
    detailsJson: text("details_json"),
  },
  (table) => [
    index("audit_issues_audit_type_idx").on(table.auditId, table.issueType),
    index("audit_issues_page_id_idx").on(table.pageId),
  ],
);

// One row per Lighthouse test (mobile + desktop per page).
export const auditLighthouseResults = sqliteTable(
  "audit_lighthouse_results",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => auditPages.id, { onDelete: "cascade" }),
    strategy: text("strategy", { enum: ["mobile", "desktop"] }).notNull(),
    performanceScore: integer("performance_score"),
    accessibilityScore: integer("accessibility_score"),
    bestPracticesScore: integer("best_practices_score"),
    seoScore: integer("seo_score"),
    lcpMs: real("lcp_ms"),
    cls: real("cls"),
    inpMs: real("inp_ms"),
    ttfbMs: real("ttfb_ms"),
    errorMessage: text("error_message"),
    r2Key: text("r2_key"),
    payloadSizeBytes: integer("payload_size_bytes"),
  },
  (table) => [
    index("audit_lighthouse_results_audit_id_idx").on(table.auditId),
    index("audit_lighthouse_results_page_id_idx").on(table.pageId),
  ],
);

// ============================================================================
// Content guideline evaluation
// ============================================================================
// Kept separate from `audit_issues` on purpose. That table's severity is looked
// up from a fixed registry of ~29 crawler issue types (see shared/audit-issues),
// and its whole payload is shipped to the browser unpaginated; folding 117
// catalog rules into it would break the lookup and multiply that payload.

// One row per page put through the guideline catalog.
export const auditPageEvaluations = sqliteTable(
  "audit_page_evaluations",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: text("page_id").references(() => auditPages.id, {
      onDelete: "cascade",
    }),
    pageUrl: text("page_url").notNull(),
    // Which catalog produced this verdict. Google revises its guidelines, so a
    // verdict is only comparable to another from the same catalog version.
    catalogVersion: text("catalog_version").notNull(),
    // Classification that decided which rules were asked at all.
    pageType: text("page_type"),
    ymyl: integer("ymyl", { mode: "boolean" }).notNull().default(false),
    ymylTopicsJson: text("ymyl_topics_json"),
    aiSuspected: integer("ai_suspected", { mode: "boolean" })
      .notNull()
      .default(false),
    verdict: text("verdict", {
      enum: ["pass", "pass_with_warnings", "revise", "reject"],
    }).notNull(),
    criticalFails: integer("critical_fails").notNull().default(0),
    highFails: integer("high_fails").notNull().default(0),
    mediumFails: integer("medium_fails").notNull().default(0),
    lowFails: integer("low_fails").notNull().default(0),
    // How many applicable rules got no answer — the honesty column. A verdict
    // resting on 30 unknowns is not the same as one resting on none.
    unknownCount: integer("unknown_count").notNull().default(0),
    // Which judge answered, so a later catalog or model change is attributable.
    judge: text("judge"),
    evaluatedAt: text("evaluated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    // Set when the page could not be evaluated; the row still records the try.
    errorMessage: text("error_message"),
  },
  (table) => [
    index("audit_page_evaluations_audit_id_idx").on(table.auditId),
    index("audit_page_evaluations_page_id_idx").on(table.pageId),
  ],
);

// One row per rule that did NOT pass. Passes are derived from the applicable
// rule set, so a clean page costs no rows.
export const auditRuleResults = sqliteTable(
  "audit_rule_results",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    evaluationId: text("evaluation_id")
      .notNull()
      .references(() => auditPageEvaluations.id, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    ruleId: text("rule_id").notNull(),
    status: text("status", {
      enum: ["fail", "warn", "unknown"],
    }).notNull(),
    severity: text("severity", {
      enum: ["critical", "high", "medium", "low"],
    }).notNull(),
    // 1-5 for graded rules, null for binary ones.
    score: integer("score"),
    // The judge's own certainty, kept so a finding can be weighed later.
    confidence: real("confidence"),
    // Short quote from the page backing the finding. Null when the judge that
    // answered cannot produce text (decision models return values, not prose).
    evidence: text("evidence"),
    reason: text("reason"),
    // Copied from the catalog at write time so a report stays readable after
    // the catalog moves on.
    remediation: text("remediation"),
  },
  (table) => [
    index("audit_rule_results_audit_rule_idx").on(table.auditId, table.ruleId),
    index("audit_rule_results_evaluation_id_idx").on(table.evaluationId),
  ],
);
