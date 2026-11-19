/**
 * Every issue of an audit in one read, for the tools that work on the whole
 * set: comparing two audits, grouping issues by URL template. The results page
 * and get_audit_issues' per-page rows go through auditResultsQueries instead,
 * which pages them.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditIssues } from "@/db/schema";

export function getIssuesForAudit(
  auditId: string,
  filters: { severity?: "critical" | "warning" | "info"; issueType?: string },
) {
  return db
    .select()
    .from(auditIssues)
    .where(
      and(
        eq(auditIssues.auditId, auditId),
        filters.severity
          ? eq(auditIssues.severity, filters.severity)
          : undefined,
        filters.issueType
          ? eq(auditIssues.issueType, filters.issueType)
          : undefined,
      ),
    );
}
