import { sort } from "remeda";
import { siteHost } from "@/server/features/bing/bingUrls";
import { BingPerformanceService } from "@/server/features/bing/services/BingPerformanceService";
import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { UmamiReportingService } from "@/server/features/umami/services/UmamiReportingService";

// Organic landing pages from Umami next to the same pages' Search Console and
// Bing numbers, joined by path on the project's host.

const UMAMI_ROWS = 500;
const ENGINE_ROWS = 1_000;
const RESULT_ROWS = 500;
// "High impressions but poor retention": a page searchers see often whose
// organic visits mostly leave after one page.
const HIGH_IMPRESSIONS = 100;
const POOR_RETENTION_BOUNCE = 0.7;
// "Visits without Search Console clicks": enough organic visits to rule out
// noise while Google reports no click for the page.
const MIN_UNATTRIBUTED_VISITS = 3;

type EngineMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

type EngineStatus = "connected" | "not_connected" | "reconnect";

/** Path without a trailing slash (the root stays "/"). */
function pathKey(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare || "/";
}

/** An engine's page URL as a path on the project's host, or null when the
 *  page is on another host (a domain property spans subdomains). */
function enginePageKey(page: string, host: string | null): string | null {
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    return null;
  }
  if (host && siteHost(url.hostname) !== host) return null;
  return pathKey(url.pathname);
}

async function searchConsolePages(
  projectId: string,
  dates: { startDate: string; endDate: string },
): Promise<{ status: EngineStatus; rows: Map<string, EngineMetrics> | null }> {
  try {
    const result = await GscService.getPerformance({
      projectId,
      ...dates,
      dimensions: ["page"],
      rowLimit: ENGINE_ROWS,
      startRow: 0,
      type: "web",
      dataState: "all",
    });
    const rows = new Map<string, EngineMetrics & { url: string }>();
    for (const row of result.rows) {
      const url = row.keys?.[0];
      if (url) {
        rows.set(url, {
          url,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        });
      }
    }
    return { status: "connected", rows };
  } catch (error) {
    if (error instanceof GscNotConnectedError) {
      return { status: "not_connected", rows: null };
    }
    if (isExpectedGrantFailure(error))
      return { status: "reconnect", rows: null };
    throw error;
  }
}

async function bingPages(
  projectId: string,
  dates: { startDate: string; endDate: string },
): Promise<{ status: EngineStatus; rows: Map<string, EngineMetrics> | null }> {
  const result = await BingPerformanceService.table(projectId, {
    ...dates,
    dimension: "page",
    sort: "clicks",
    limit: ENGINE_ROWS,
    offset: 0,
  });
  if (!result.connected) return { status: "not_connected", rows: null };
  return {
    status: "connected",
    rows: new Map(
      result.rows.map((row) => [
        row.key,
        {
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.avgImpressionPosition,
        },
      ]),
    ),
  };
}

/** Engine rows keyed by path on `host`, summing pages that differ only in
 *  scheme, `www.`, trailing slash or query string. */
function byPath(
  rows: Map<string, EngineMetrics> | null,
  host: string | null,
): Map<string, EngineMetrics> {
  const out = new Map<string, EngineMetrics & { weighted: number }>();
  for (const [url, metrics] of rows ?? []) {
    const key = enginePageKey(url, host);
    if (!key) continue;
    const sum = out.get(key) ?? {
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: null,
      weighted: 0,
    };
    sum.clicks += metrics.clicks;
    sum.impressions += metrics.impressions;
    sum.weighted += (metrics.position ?? 0) * metrics.impressions;
    sum.ctr = sum.impressions > 0 ? sum.clicks / sum.impressions : 0;
    sum.position =
      sum.impressions > 0
        ? Math.round((sum.weighted / sum.impressions) * 10) / 10
        : metrics.position;
    out.set(key, sum);
  }
  return new Map(
    [...out].map(([key, { weighted: _weighted, ...metrics }]) => [
      key,
      metrics,
    ]),
  );
}

/**
 * Umami's organic entry pages for the range, with each page's Search Console
 * and Bing clicks, impressions and position. Pages either engine shows that
 * received no organic visit are included too. Search Console lags about three
 * days, so the newest days of a range have Umami visits but no Google data.
 */
async function getOrganicLandings(input: {
  projectId: string;
  startDate: string;
  endDate: string;
}) {
  const dates = { startDate: input.startDate, endDate: input.endDate };
  const umami = await UmamiReportingService.getBreakdown({
    projectId: input.projectId,
    ...dates,
    type: "entry",
    channel: "organic_search",
    comparePreviousPeriod: false,
    limit: UMAMI_ROWS,
    offset: 0,
  });
  const [gsc, bing] = await Promise.all([
    searchConsolePages(input.projectId, dates),
    bingPages(input.projectId, dates),
  ]);
  const host =
    umami.source.projectHost ??
    (umami.source.websiteDomain ? siteHost(umami.source.websiteDomain) : null);
  const google = byPath(gsc.rows, host);
  const microsoft = byPath(bing.rows, host);

  const paths = new Set([
    ...umami.rows.map((row) => pathKey(row.name)),
    ...google.keys(),
    ...microsoft.keys(),
  ]);
  const umamiByPath = new Map(
    umami.rows.map((row) => [pathKey(row.name), row]),
  );
  const rows = [...paths].map((path) => {
    const visits = umamiByPath.get(path);
    const googleRow = google.get(path) ?? null;
    const organicVisits = visits?.visits ?? visits?.count ?? 0;
    const bounceRate = visits?.bounceRate ?? null;
    return {
      path,
      visits: organicVisits,
      visitors: visits?.visitors ?? null,
      bounceRate,
      avgVisitSeconds: visits?.avgVisitSeconds ?? null,
      google: googleRow,
      bing: microsoft.get(path) ?? null,
      highImpressionsPoorRetention:
        (googleRow?.impressions ?? 0) >= HIGH_IMPRESSIONS &&
        bounceRate !== null &&
        bounceRate >= POOR_RETENTION_BOUNCE,
      visitsWithoutGscClicks:
        gsc.status === "connected" &&
        organicVisits >= MIN_UNATTRIBUTED_VISITS &&
        (googleRow?.clicks ?? 0) === 0,
    };
  });

  return {
    ok: true as const,
    source: umami.source,
    request: umami.request,
    organicDetection: umami.organicDetection,
    searchConsole: gsc.status,
    bing: bing.status,
    thresholds: {
      highImpressions: HIGH_IMPRESSIONS,
      poorRetentionBounceRate: POOR_RETENTION_BOUNCE,
      minUnattributedVisits: MIN_UNATTRIBUTED_VISITS,
    },
    rows: sort(
      rows,
      (a, b) =>
        b.visits - a.visits ||
        (b.google?.impressions ?? 0) - (a.google?.impressions ?? 0),
    ).slice(0, RESULT_ROWS),
    truncated: umami.rows.length >= UMAMI_ROWS || paths.size > RESULT_ROWS,
  };
}

export const UmamiOrganicLandingService = { getOrganicLandings };
