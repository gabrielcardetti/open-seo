/**
 * Google Search Console sitemap indexing summary for SITE-06 and the site
 * judge. Pure over the stored `url_inspections` rows: only monitored sitemap
 * URLs count, so one-off manual checks never distort the site-wide ratio.
 */
import { sort } from "remeda";
import { segmentsOf } from "./site-trust";

/** One URL row from the project's GSC indexing monitor (`url_inspections`). */
export interface SiteGscInspectionInput {
  url: string;
  inSitemap?: boolean;
  verdict: string | null;
  coverageState: string | null;
}

export interface SiteGscSectionCoverage {
  /** Path prefix summarizing the section, e.g. `/bopv/2026/*` or `/boletines/*`. */
  section: string;
  inspected: number;
  indexed: number;
  crawledNotIndexed: number;
  discoveredNotIndexed: number;
  otherNotIndexed: number;
  /** Share of all monitored sitemap URLs belonging to this section (0..1). */
  sitemapShare: number;
}

/** Site-wide Google Search Console indexing summary for SITE-06 and the site judge. */
export interface SiteGscIndexing {
  monitored: number;
  inspected: number;
  indexed: number;
  crawledNotIndexed: number;
  discoveredNotIndexed: number;
  otherNotIndexed: number;
  /** Sections with >= 10 inspected URLs and >= 40% non-indexed (up to 6). */
  problemSections: SiteGscSectionCoverage[];
}

export interface SiteSectionShare {
  /** First-level path section (`/` for root, `/blog/` for nested). */
  section: string;
  indexable: number;
  /** Share of all indexable pages on the site (0..1). */
  share: number;
}

const MAX_SECTION_SHARES = 10;
const MAX_GSC_PROBLEM_SECTIONS = 6;
const MIN_SECTION_INSPECTED = 10;

function gscSectionKey(url: string): string {
  try {
    const segments = segmentsOf(new URL(url).pathname);
    if (segments.length === 0) return "/";
    if (segments.length === 1) return `/${segments[0]}`;
    if (segments.length >= 3) return `/${segments[0]}/${segments[1]}/*`;
    return `/${segments[0]}/*`;
  } catch {
    return "(other)";
  }
}

export function buildSiteGscIndexing(
  rows: readonly SiteGscInspectionInput[] | null | undefined,
): SiteGscIndexing | null {
  if (!rows || rows.length === 0) return null;
  const monitoredRows = rows.filter((row) => row.inSitemap !== false);
  if (monitoredRows.length === 0) return null;

  let inspected = 0;
  let indexed = 0;
  let crawledNotIndexed = 0;
  let discoveredNotIndexed = 0;
  let otherNotIndexed = 0;

  const bySection = new Map<
    string,
    {
      monitored: number;
      inspected: number;
      indexed: number;
      crawledNotIndexed: number;
      discoveredNotIndexed: number;
      otherNotIndexed: number;
    }
  >();

  for (const row of monitoredRows) {
    const section = gscSectionKey(row.url);
    const bucket = bySection.get(section) ?? {
      monitored: 0,
      inspected: 0,
      indexed: 0,
      crawledNotIndexed: 0,
      discoveredNotIndexed: 0,
      otherNotIndexed: 0,
    };
    bucket.monitored += 1;

    const hasResult = row.verdict !== null || row.coverageState !== null;
    if (hasResult) {
      inspected += 1;
      bucket.inspected += 1;
      const state = (row.coverageState ?? "").toLowerCase();
      if (row.verdict === "PASS") {
        indexed += 1;
        bucket.indexed += 1;
      } else if (state.includes("crawled") && state.includes("not indexed")) {
        crawledNotIndexed += 1;
        bucket.crawledNotIndexed += 1;
      } else if (
        state.includes("discovered") &&
        state.includes("not indexed")
      ) {
        discoveredNotIndexed += 1;
        bucket.discoveredNotIndexed += 1;
      } else {
        otherNotIndexed += 1;
        bucket.otherNotIndexed += 1;
      }
    }
    bySection.set(section, bucket);
  }

  if (inspected === 0) return null;

  const problemSections = sort(
    Array.from(
      bySection,
      ([section, b]): SiteGscSectionCoverage => ({
        section,
        inspected: b.inspected,
        indexed: b.indexed,
        crawledNotIndexed: b.crawledNotIndexed,
        discoveredNotIndexed: b.discoveredNotIndexed,
        otherNotIndexed: b.otherNotIndexed,
        sitemapShare:
          Math.round((b.monitored / monitoredRows.length) * 1000) / 1000,
      }),
    ).filter(
      (s) =>
        s.inspected >= MIN_SECTION_INSPECTED &&
        (s.inspected - s.indexed) / s.inspected >= 0.4,
    ),
    (a, b) =>
      b.inspected - b.indexed - (a.inspected - a.indexed) ||
      a.section.localeCompare(b.section),
  ).slice(0, MAX_GSC_PROBLEM_SECTIONS);

  return {
    monitored: monitoredRows.length,
    inspected,
    indexed,
    crawledNotIndexed,
    discoveredNotIndexed,
    otherNotIndexed,
    problemSections,
  };
}

export function buildSectionShares(
  paths: readonly string[],
): SiteSectionShare[] {
  if (paths.length === 0) return [];
  const counts = new Map<string, number>();
  for (const path of paths) {
    const segs = segmentsOf(path);
    const key = segs.length === 0 ? "/" : `/${segs[0]}/`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sort(
    Array.from(
      counts,
      ([section, indexable]): SiteSectionShare => ({
        section,
        indexable,
        share: Math.round((indexable / paths.length) * 1000) / 1000,
      }),
    ),
    (a, b) => b.indexable - a.indexable || a.section.localeCompare(b.section),
  ).slice(0, MAX_SECTION_SHARES);
}
