/**
 * Cross-page (multipage) issue checks over the app DB's page rows:
 * duplicates, redirect chains/loops, hreflang return links and the site's
 * HSTS header. Pure set-queries over crawl data — no fetching, no DOM.
 *
 * The two link-edge checks (broken-internal-link, orphan-page) live in the
 * audit's scratchpad Durable Object (AuditScratchpad.runFinalizeChecks),
 * next to the link edges themselves — link rows never touch the app DB.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { auditPageHreflang, auditPages } from "@/db/schema";
import {
  findDuplicates,
  findMissingHreflangReturnLinks,
  findMissingHsts,
  findRedirectChainsAndLoops,
  type HreflangGap,
  type SlimPage,
} from "@/server/lib/audit/issues/multipage-checks";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";

export async function runMultipageChecks(input: {
  auditId: string;
}): Promise<DetectedIssue[]> {
  const pages: SlimPage[] = await db
    .select({
      id: auditPages.id,
      url: auditPages.url,
      statusCode: auditPages.statusCode,
      fetchClass: auditPages.fetchClass,
      title: auditPages.title,
      metaDescription: auditPages.metaDescription,
      contentHash: auditPages.contentHash,
      redirectUrl: auditPages.redirectUrl,
      wordCount: auditPages.wordCount,
      isIndexable: auditPages.isIndexable,
      canonicalUrl: auditPages.canonicalUrl,
      headerCanonicalUrl: auditPages.headerCanonicalUrl,
      hasHsts: auditPages.hasHsts,
    })
    .from(auditPages)
    .where(eq(auditPages.auditId, input.auditId));

  return [
    ...findDuplicates(pages),
    ...findRedirectChainsAndLoops(pages),
    ...findMissingHreflangReturnLinks(pages, await findHreflangGaps(input)),
    ...findMissingHsts(pages),
  ];
}

const source = alias(auditPages, "source_page");
const target = alias(auditPages, "target_page");
const back = alias(auditPageHreflang, "back_link");

/**
 * Hreflang alternates that point at a crawled page which does not list the
 * source page back. An anti-join in SQL, so a site with thousands of pages
 * times dozens of languages never loads every annotation into memory.
 */
function findHreflangGaps(input: { auditId: string }): Promise<HreflangGap[]> {
  return db
    .select({
      sourcePageId: auditPageHreflang.pageId,
      targetPageId: target.id,
    })
    .from(auditPageHreflang)
    .innerJoin(source, eq(source.id, auditPageHreflang.pageId))
    .innerJoin(
      target,
      and(
        eq(target.auditId, auditPageHreflang.auditId),
        eq(target.url, auditPageHreflang.href),
      ),
    )
    .leftJoin(back, and(eq(back.pageId, target.id), eq(back.href, source.url)))
    .where(
      and(
        eq(auditPageHreflang.auditId, input.auditId),
        ne(target.id, auditPageHreflang.pageId),
        isNull(back.pageId),
      ),
    );
}
