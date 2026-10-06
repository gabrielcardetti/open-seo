/**
 * Per-page child rows written with each crawled batch: the schema.org types
 * and hreflang alternates a page declares.
 */
import { inArray } from "drizzle-orm";
import { chunk } from "remeda";
import { auditPageHreflang, auditPageSchemaTypes } from "@/db/schema";
import { runBatch } from "@/db/runBatch";
import type { CrawledPageResult } from "@/server/lib/audit/types";

/** Pages per batch: their deletes plus inserts stay well inside a D1 batch. */
const CHILD_ROW_PAGE_CHUNK = 50;

/**
 * Schema types and hreflang alternates of a batch of pages. A retried step may
 * have fetched different markup, so each page's rows are replaced, not merged.
 * Row counts follow D1's 100-parameter statements: 3 columns x 30 rows and
 * 4 columns x 25 rows.
 */
export async function replacePageChildRows(
  auditId: string,
  pages: CrawledPageResult[],
) {
  for (const pageChunk of chunk(pages, CHILD_ROW_PAGE_CHUNK)) {
    const pageIds = pageChunk.map((page) => page.id);
    const typeRows = pageChunk.flatMap((page) =>
      page.structuredData.types.map((schemaType) => ({
        auditId,
        pageId: page.id,
        schemaType,
      })),
    );
    const hreflangRows = pageChunk.flatMap((page) =>
      page.hreflangLinks.map((link) => ({ auditId, pageId: page.id, ...link })),
    );
    await runBatch((tx) => [
      tx
        .delete(auditPageSchemaTypes)
        .where(inArray(auditPageSchemaTypes.pageId, pageIds)),
      tx
        .delete(auditPageHreflang)
        .where(inArray(auditPageHreflang.pageId, pageIds)),
      ...chunk(typeRows, 30).map((rows) =>
        tx.insert(auditPageSchemaTypes).values(rows).onConflictDoNothing(),
      ),
      ...chunk(hreflangRows, 25).map((rows) =>
        tx.insert(auditPageHreflang).values(rows).onConflictDoNothing(),
      ),
    ]);
  }
}
