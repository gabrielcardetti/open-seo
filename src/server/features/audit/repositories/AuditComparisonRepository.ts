/**
 * Reads for comparing one audit with an earlier one of the same project:
 * which pages changed content between them.
 */
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { audits, auditPages } from "@/db/schema";

/** Per-page body-text fingerprints, with what decides if a page is indexable. */
async function getPageHashesForAudit(auditId: string) {
  return db
    .select({
      url: auditPages.url,
      statusCode: auditPages.statusCode,
      isIndexable: auditPages.isIndexable,
      contentHash: auditPages.contentHash,
    })
    .from(auditPages)
    .where(eq(auditPages.auditId, auditId));
}

/** Completed audits of the project that started before this one, newest first. */
async function getPreviousCompletedAudits(
  projectId: string,
  audit: { id: string; startedAt: string },
  limit: number,
) {
  return db
    .select({ id: audits.id, startUrl: audits.startUrl })
    .from(audits)
    .where(
      and(
        eq(audits.projectId, projectId),
        eq(audits.status, "completed"),
        ne(audits.id, audit.id),
        lt(audits.startedAt, audit.startedAt),
      ),
    )
    .orderBy(desc(audits.startedAt))
    .limit(limit);
}

export const AuditComparisonRepository = {
  getPageHashesForAudit,
  getPreviousCompletedAudits,
} as const;
