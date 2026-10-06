/**
 * Reads for comparing one audit with an earlier one of the same project:
 * which pages changed content between them, and which of their SEO signals
 * (canonical, indexability, title, headings, structured data) drifted.
 */
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { audits, auditPageSchemaTypes, auditPages } from "@/db/schema";

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

/** The per-page signals the comparison's drift rules read. */
async function getPageSignalsForAudit(auditId: string) {
  return db
    .select({
      url: auditPages.url,
      statusCode: auditPages.statusCode,
      contentHash: auditPages.contentHash,
      canonicalUrl: auditPages.canonicalUrl,
      headerCanonicalUrl: auditPages.headerCanonicalUrl,
      isIndexable: auditPages.isIndexable,
      title: auditPages.title,
      metaDescription: auditPages.metaDescription,
      h1Text: auditPages.h1Text,
      ogTitle: auditPages.ogTitle,
      ogDescription: auditPages.ogDescription,
      ogImage: auditPages.ogImage,
      hasStructuredData: auditPages.hasStructuredData,
    })
    .from(auditPages)
    .where(eq(auditPages.auditId, auditId));
}

/** Schema.org types each page declared, by page URL. */
async function getSchemaTypesForAudit(auditId: string) {
  return db
    .select({
      url: auditPages.url,
      schemaType: auditPageSchemaTypes.schemaType,
    })
    .from(auditPageSchemaTypes)
    .innerJoin(auditPages, eq(auditPages.id, auditPageSchemaTypes.pageId))
    .where(eq(auditPageSchemaTypes.auditId, auditId));
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
  getPageSignalsForAudit,
  getSchemaTypesForAudit,
  getPreviousCompletedAudits,
} as const;
