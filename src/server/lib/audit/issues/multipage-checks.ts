/**
 * Pure cross-page checks (no database access): duplicate grouping, redirect
 * chain/loop detection, hreflang return links and the site's HSTS header.
 * The queries that feed them live in multipage.ts.
 */
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";
import type { PageFetchClass } from "@/shared/audit-fetch-class";

const DUPLICATE_GROUP_SAMPLE = 3;
const HREFLANG_GAP_SAMPLE = 10;

export interface SlimPage {
  id: string;
  url: string;
  statusCode: number | null;
  fetchClass: PageFetchClass;
  title: string | null;
  metaDescription: string | null;
  contentHash: string | null;
  redirectUrl: string | null;
  wordCount: number;
  isIndexable: boolean;
  canonicalUrl: string | null;
  headerCanonicalUrl: string | null;
  hasHsts: boolean;
}

/** A crawled alternate that does not name its source page in return. */
export interface HreflangGap {
  sourcePageId: string;
  targetPageId: string;
}

function isOkHtmlPage(page: SlimPage): boolean {
  return (
    page.fetchClass === "ok" &&
    page.statusCode !== null &&
    page.statusCode >= 200 &&
    page.statusCode < 300
  );
}

/**
 * Pages the owner already de-duplicated (noindex, or canonicalized to
 * another URL) don't belong in duplicate groups — flagging them tells the
 * user to fix something they already fixed.
 */
function isDuplicateCandidate(page: SlimPage): boolean {
  return isOkHtmlPage(page) && page.isIndexable && isSelfCanonical(page);
}

function isSelfCanonical(page: SlimPage): boolean {
  const effectiveCanonical = page.canonicalUrl ?? page.headerCanonicalUrl;
  return !effectiveCanonical || effectiveCanonical === page.url;
}

/**
 * One issue per page whose alternates were crawled but do not link back.
 * Only canonical 2xx pages on both ends count: a canonicalized source is
 * already reported as hreflang-on-canonicalized-page, and an alternate that
 * redirects or canonicalizes elsewhere is a different problem.
 */
export function findMissingHreflangReturnLinks(
  pages: SlimPage[],
  gaps: HreflangGap[],
): DetectedIssue[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const isCanonicalOk = (page: SlimPage | undefined): page is SlimPage =>
    page !== undefined && isOkHtmlPage(page) && isSelfCanonical(page);

  const alternatesBySource = new Map<string, string[]>();
  for (const gap of gaps) {
    const sourcePage = byId.get(gap.sourcePageId);
    const targetPage = byId.get(gap.targetPageId);
    if (!isCanonicalOk(sourcePage) || !isCanonicalOk(targetPage)) continue;
    const alternates = alternatesBySource.get(sourcePage.id);
    if (alternates) alternates.push(targetPage.url);
    else alternatesBySource.set(sourcePage.id, [targetPage.url]);
  }

  return Array.from(alternatesBySource, ([pageId, alternates]) => ({
    issueType: "hreflang-missing-return-link" as const,
    pageId,
    pageUrl: byId.get(pageId)!.url,
    details: {
      alternates: alternates.slice(0, HREFLANG_GAP_SAMPLE),
      alternateCount: alternates.length,
    },
  }));
}

/**
 * HSTS is a site-wide header, so it is reported once per https origin whose
 * crawled pages never sent it, not on every page.
 */
export function findMissingHsts(pages: SlimPage[]): DetectedIssue[] {
  const originsWithHsts = new Set<string>();
  const pagesByOrigin = new Map<string, SlimPage[]>();
  for (const page of pages) {
    if (!isOkHtmlPage(page) || !page.url.startsWith("https://")) continue;
    const origin = new URL(page.url).origin;
    if (page.hasHsts) originsWithHsts.add(origin);
    const group = pagesByOrigin.get(origin);
    if (group) group.push(page);
    else pagesByOrigin.set(origin, [page]);
  }

  const issues: DetectedIssue[] = [];
  for (const [origin, group] of pagesByOrigin) {
    if (originsWithHsts.has(origin)) continue;
    const home = group.find((page) => page.url === `${origin}/`);
    issues.push({
      issueType: "missing-hsts",
      pageId: home?.id ?? null,
      pageUrl: `${origin}/`,
      details: { pagesChecked: group.length },
    });
  }
  return issues;
}

export function findDuplicates(pages: SlimPage[]): DetectedIssue[] {
  const okPages = pages.filter(isDuplicateCandidate);

  const groupBy = (
    keyOf: (page: SlimPage) => string | null,
  ): Map<string, SlimPage[]> => {
    const groups = new Map<string, SlimPage[]>();
    for (const page of okPages) {
      const key = keyOf(page);
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.push(page);
      else groups.set(key, [page]);
    }
    return groups;
  };

  const issues: DetectedIssue[] = [];
  const emitGroups = (
    groups: Map<string, SlimPage[]>,
    issueType: DetectedIssue["issueType"],
  ) => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const page of group) {
        issues.push({
          issueType,
          pageId: page.id,
          pageUrl: page.url,
          details: {
            groupSize: group.length,
            otherUrls: group
              .filter((other) => other.id !== page.id)
              .slice(0, DUPLICATE_GROUP_SAMPLE)
              .map((other) => other.url),
          },
        });
      }
    }
  };

  emitGroups(
    groupBy((page) => page.title || null),
    "duplicate-title",
  );
  emitGroups(
    groupBy((page) => page.metaDescription || null),
    "duplicate-meta-description",
  );
  emitGroups(
    groupBy((page) => (page.wordCount > 0 ? page.contentHash : null)),
    "duplicate-content",
  );
  return issues;
}

export function findRedirectChainsAndLoops(pages: SlimPage[]): DetectedIssue[] {
  const redirects = new Map<string, SlimPage>();
  for (const page of pages) {
    const isRedirect =
      page.statusCode !== null &&
      page.statusCode >= 300 &&
      page.statusCode < 400 &&
      page.redirectUrl;
    if (isRedirect) redirects.set(page.url, page);
  }

  const redirectTargets = new Set(
    Array.from(redirects.values(), (page) => page.redirectUrl!),
  );

  const issues: DetectedIssue[] = [];
  const walked = new Set<string>();

  // Walk from chain heads (redirects nothing else redirects to), so a 5-hop
  // chain yields one issue, not five.
  for (const [url, head] of redirects) {
    if (redirectTargets.has(url)) continue;

    const hops: string[] = [url];
    const seen = new Set(hops);
    walked.add(url);
    let current = head.redirectUrl;
    let isLoop = false;
    while (current) {
      if (seen.has(current)) {
        isLoop = true;
        hops.push(current);
        break;
      }
      hops.push(current);
      seen.add(current);
      if (redirects.has(current)) walked.add(current);
      current = redirects.get(current)?.redirectUrl ?? null;
    }

    if (isLoop) {
      issues.push({
        issueType: "redirect-loop",
        pageId: head.id,
        pageUrl: url,
        details: { hops },
      });
    } else if (hops.length > 2) {
      // url -> a -> b: two redirects before content = a chain
      issues.push({
        issueType: "redirect-chain",
        pageId: head.id,
        pageUrl: url,
        details: { hops, finalUrl: hops[hops.length - 1] },
      });
    }
  }

  // Headless cycles (every member is also a target — e.g. a↔b, or a→a) are
  // never reached from a head; emit one loop issue per cycle.
  for (const [url, page] of redirects) {
    if (walked.has(url)) continue;

    const cycle: string[] = [];
    let current: string | null = url;
    while (current && !walked.has(current)) {
      walked.add(current);
      cycle.push(current);
      current = redirects.get(current)?.redirectUrl ?? null;
    }
    issues.push({
      issueType: "redirect-loop",
      pageId: page.id,
      pageUrl: url,
      details: { hops: [...cycle, url] },
    });
  }

  return issues;
}
