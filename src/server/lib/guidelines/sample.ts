/**
 * Which crawled pages get put through the guideline catalog.
 *
 * Evaluating content costs a judge call per page, so a 10,000-page crawl is not
 * evaluated wholesale. The sample is built to answer "what is this site like?"
 * rather than "what is every URL like?": one page per URL template, deduplicated
 * by body hash, biased toward the pages a reader would actually land on.
 *
 * The shape follows `selectLighthouseSample` in ../audit/lighthouse.ts, which
 * solves the same problem for a different expensive per-page phase.
 */
import { sort } from "remeda";
import { canonicalUrlKey, detectUrlTemplate } from "../audit/url-utils";

/** Default cap. Enough templates to characterize a site, few enough to be cheap. */
export const DEFAULT_GUIDELINES_SAMPLE = 30;

/** Extra examples per template once every template has one. */
const EXTRA_PER_TEMPLATE = 2;

type GuidelinesStrategy = "none" | "sample" | "all";

export interface GuidelinesSamplePage {
  id: string;
  url: string;
  statusCode: number | null;
  isIndexable: boolean;
  fetchClass: string;
  wordCount: number;
  contentHash: string | null;
  crawlDepth: number | null;
}

interface SampledPage {
  pageId: string;
  url: string;
}

function parsedPath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * A page worth judging: fetched cleanly, 2xx, indexable, and addressable.
 *
 * Indexability is the important filter. A `noindex` page is not competing in
 * Search, so Google's content guidelines have nothing to say about it, and
 * judging it spends a call to produce a finding nobody should act on.
 */
function isEligible(page: GuidelinesSamplePage): boolean {
  return (
    page.fetchClass === "ok" &&
    page.statusCode !== null &&
    page.statusCode >= 200 &&
    page.statusCode < 300 &&
    page.isIndexable &&
    parsedPath(page.url) !== null
  );
}

export function selectGuidelinesSample(
  pages: readonly GuidelinesSamplePage[],
  startUrl: string,
  strategy: GuidelinesStrategy,
  limit: number = DEFAULT_GUIDELINES_SAMPLE,
): SampledPage[] {
  if (strategy === "none") return [];

  const eligible = pages.filter(isEligible);
  if (strategy === "all") {
    return eligible.map((page) => ({ pageId: page.id, url: page.url }));
  }

  const selected: SampledPage[] = [];
  const takenIds = new Set<string>();
  // Identical body text gets one verdict, not N. The crawl already hashes body
  // text for duplicate detection, so this is free — and duplicates are exactly
  // the pages whose verdicts would agree anyway.
  const seenHashes = new Set<string>();

  const take = (page: GuidelinesSamplePage): boolean => {
    if (takenIds.has(page.id) || selected.length >= limit) return false;
    if (page.contentHash) {
      if (seenHashes.has(page.contentHash)) return false;
      seenHashes.add(page.contentHash);
    }
    takenIds.add(page.id);
    selected.push({ pageId: page.id, url: page.url });
    return true;
  };

  // The start URL always gets judged: it carries the site's own framing, and
  // several site-level rules read off it.
  const startKey = canonicalUrlKey(startUrl);
  const startPage = eligible.find(
    (page) => canonicalUrlKey(page.url) === startKey,
  );
  if (startPage) take(startPage);

  // One page per URL template, deepest content first. Sorting by word count
  // picks the fullest example of each template rather than whichever the crawl
  // happened to reach first — a stub is a poor witness for its whole section.
  const byTemplate = new Map<string, GuidelinesSamplePage>();
  for (const page of eligible) {
    if (takenIds.has(page.id)) continue;
    const path = parsedPath(page.url);
    if (path === null) continue;
    const template = detectUrlTemplate(path);
    const incumbent = byTemplate.get(template);
    if (!incumbent || page.wordCount > incumbent.wordCount) {
      byTemplate.set(template, page);
    }
  }
  for (const page of byTemplate.values()) take(page);

  // Budget left over: add up to EXTRA_PER_TEMPLATE more pages from each
  // template, richest first. Bounded on purpose — a second and third example
  // of a template can disagree with the first, which is worth knowing, but the
  // thirtieth cannot tell you anything the first three did not. Without the
  // bound a site of 40 near-identical pages would spend the entire budget
  // re-judging one template.
  if (selected.length < limit) {
    const perTemplate = new Map<string, number>();
    const rest = sort(
      eligible.filter((page) => !takenIds.has(page.id)),
      (a, b) => b.wordCount - a.wordCount,
    );
    for (const page of rest) {
      if (selected.length >= limit) break;
      const path = parsedPath(page.url);
      if (path === null) continue;
      const template = detectUrlTemplate(path);
      const used = perTemplate.get(template) ?? 0;
      if (used >= EXTRA_PER_TEMPLATE) continue;
      if (take(page)) perTemplate.set(template, used + 1);
    }
  }

  return selected;
}

/**
 * The per-template URL counts for a host, which is what the site-scope rules
 * actually need.
 *
 * A doorway page read on its own looks unremarkable; what gives it away is that
 * two hundred near-identical siblings exist. Page-level judging structurally
 * cannot see that, so the site pass gets the inventory instead of a page.
 */
export function templateInventory(
  pages: readonly GuidelinesSamplePage[],
): Array<{ template: string; count: number; examples: string[] }> {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const path = parsedPath(page.url);
    if (path === null) continue;
    const template = detectUrlTemplate(path);
    const urls = groups.get(template);
    if (urls) urls.push(page.url);
    else groups.set(template, [page.url]);
  }
  return sort(
    Array.from(groups, ([template, urls]) => ({
      template,
      count: urls.length,
      examples: urls.slice(0, 3),
    })),
    (a, b) => b.count - a.count,
  );
}
