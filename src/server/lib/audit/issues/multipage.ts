/**
 * Cross-page checks that need the whole crawl: duplicate titles, meta
 * descriptions and content, redirect chains and loops, hreflang return links
 * and the site's HSTS header. Set-queries over crawl data — no fetching.
 *
 * Reads the audit's persisted page rows from the app DB. Link-graph checks
 * (broken links, orphan pages) are not here: they run inside the
 * audit's scratchpad Durable Object (AuditScratchpad.runFinalizeChecks),
 * next to the link edges themselves — link rows never touch the app DB.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { auditIssues, auditPageHreflang, auditPages } from "@/db/schema";
import {
  findDuplicates,
  findMissingHreflangReturnLinks,
  findMissingHsts,
  findRedirectChainsAndLoops,
  type HreflangGap,
  type SlimPage,
} from "./multipage-checks";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";

export async function runMultipageChecks(input: {
  auditId: string;
}): Promise<{ issues: DetectedIssue[]; hasUnreadShells: boolean }> {
  // Unrendered app shells carry a persisted coverage warning. Their
  // placeholder titles and loading text must not become duplicate findings.
  const shellPageIds = new Set(
    (
      await db
        .select({ pageId: auditIssues.pageId })
        .from(auditIssues)
        .where(
          and(
            eq(auditIssues.auditId, input.auditId),
            eq(auditIssues.issueType, "javascript-rendering-suspected"),
          ),
        )
    ).map((row) => row.pageId),
  );
  const pages: SlimPage[] = (
    await db
      .select({
        id: auditPages.id,
        url: auditPages.url,
        statusCode: auditPages.statusCode,
        fetchClass: auditPages.fetchClass,
        redirectUrl: auditPages.redirectUrl,
        title: auditPages.title,
        metaDescription: auditPages.metaDescription,
        contentHash: auditPages.contentHash,
        wordCount: auditPages.wordCount,
        isIndexable: auditPages.isIndexable,
        canonicalUrl: auditPages.canonicalUrl,
        headerCanonicalUrl: auditPages.headerCanonicalUrl,
        hasHsts: auditPages.hasHsts,
      })
      .from(auditPages)
      .where(eq(auditPages.auditId, input.auditId))
  ).filter((page) => !shellPageIds.has(page.id));

  return {
    issues: [
      ...findDuplicates(pages),
      ...findRedirectChainsAndLoops(pages),
      ...findMissingHreflangReturnLinks(pages, await findHreflangGaps(input)),
      ...findMissingHsts(pages),
    ],
    hasUnreadShells: shellPageIds.size > 0,
  };
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
