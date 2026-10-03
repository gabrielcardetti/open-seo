import { siteHost } from "@/server/features/bing/bingUrls";
import { shiftGa4Date } from "@/server/features/ga4/services/Ga4Dates";
import {
  OPPORTUNITY_SCORE_FORMULA,
  scoreOpportunities,
} from "@/server/features/ga4/services/opportunityScoring";
import { GscService } from "@/server/features/gsc/services/GscService";
import { UmamiReportingService } from "@/server/features/umami/services/UmamiReportingService";
import { UmamiConnectionRepository } from "@/server/features/umami/repositories/UmamiConnectionRepository";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { UmamiNotConnectedError } from "@/server/lib/umami/umamiErrors";

const GSC_ROW_LIMIT = 1_000;
const UMAMI_ROW_LIMIT = 1_000;

type UmamiOutcome = {
  visits: number;
  visitors: number;
  pageviews: number;
  bounceRate: number | null;
  avgVisitSeconds: number | null;
};

type Candidate = {
  page: string;
  normalizedPage: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  joinStatus: "joined" | "gsc_only";
  umami: UmamiOutcome | null;
  score: number | null;
  scoreComponents:
    | ReturnType<typeof scoreOpportunities>[number]["scoreComponents"]
    | null;
};

/** Path without a trailing slash (the root stays "/"). */
function pathKey(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path || "/";
}

/** A Search Console page as a path on the Umami website's host, or null when
 *  the page is on another host (a domain property spans subdomains). */
function gscPageKey(page: string, websiteHost: string | null): string | null {
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    return null;
  }
  if (websiteHost && siteHost(url.hostname) !== websiteHost) return null;
  return pathKey(url.pathname);
}

/**
 * Search opportunities when the project's analytics come from Umami: Search
 * Console pages ranking 4–20, joined by path to Umami entry pages reached from
 * search engines, scored with the same formula as the Google Analytics read.
 * Umami can't tie custom events to the page a visit entered on, so business
 * value is the non-bounce rate (the share of organic visits that went past
 * the landing page), the counterpart of GA4's engagement-rate fallback.
 */
async function getOpportunities(
  input: {
    projectId: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  },
  opts: { now?: Date } = {},
) {
  const limit = input.limit ?? 50;
  const [umamiConnection, gscConnection] = await Promise.all([
    UmamiConnectionRepository.getByProjectId(input.projectId),
    GscService.getConnection(input.projectId),
  ]);
  if (!umamiConnection?.websiteId) {
    throw new UmamiNotConnectedError(input.projectId);
  }
  if (!gscConnection) throw new GscNotConnectedError(input.projectId);

  // Search Console lags about three days; end there unless asked otherwise.
  const now = opts.now ?? new Date();
  const endDate =
    input.endDate ?? shiftGa4Date(now.toISOString().slice(0, 10), -3);
  const startDate = input.startDate ?? shiftGa4Date(endDate, -27);

  const umami = await UmamiReportingService.getOrganicEntryPages({
    projectId: input.projectId,
    startDate,
    endDate,
    limit: UMAMI_ROW_LIMIT,
  });
  const gsc = await GscService.getPerformance({
    projectId: input.projectId,
    dimensions: ["page"],
    startDate,
    endDate,
    rowLimit: GSC_ROW_LIMIT,
    startRow: 0,
    type: "web",
    dataState: "final",
  });

  const websiteHost = umami.source.websiteDomain
    ? siteHost(umami.source.websiteDomain)
    : null;
  const umamiByPath = new Map(
    umami.rows.map((row) => [pathKey(row.name), row] as const),
  );

  const candidates: Candidate[] = gsc.rows
    .filter((row) => row.position >= 4 && row.position <= 20)
    .map((row) => {
      const page = row.keys?.[0] ?? "";
      const normalizedPage = gscPageKey(page, websiteHost);
      const analytics = normalizedPage
        ? umamiByPath.get(normalizedPage)
        : undefined;
      return {
        page,
        normalizedPage,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        joinStatus: analytics ? "joined" : "gsc_only",
        umami: analytics
          ? {
              visits: analytics.visits ?? analytics.count ?? 0,
              visitors: analytics.visitors ?? 0,
              pageviews: analytics.pageviews ?? 0,
              bounceRate: analytics.bounceRate,
              avgVisitSeconds: analytics.avgVisitSeconds,
            }
          : null,
        score: null,
        scoreComponents: null,
      };
    });

  const joined = candidates.filter(
    (
      candidate,
    ): candidate is Candidate & { umami: NonNullable<Candidate["umami"]> } =>
      candidate.umami !== null,
  );
  const scores = scoreOpportunities(
    joined.map((candidate) => ({
      impressions: candidate.impressions,
      position: candidate.position,
      businessValue: 1 - (candidate.umami.bounceRate ?? 1),
    })),
  );
  joined.forEach((candidate, index) => {
    candidate.score = scores[index]?.score ?? null;
    candidate.scoreComponents = scores[index]?.scoreComponents ?? null;
  });
  candidates.sort((a, b) => {
    if (a.score == null && b.score != null) return 1;
    if (a.score != null && b.score == null) return -1;
    return (b.score ?? 0) - (a.score ?? 0) || b.impressions - a.impressions;
  });

  const returned = candidates.slice(0, limit);
  const joinedPaths = new Set(
    joined.map((candidate) => candidate.normalizedPage),
  );
  return {
    status: "ok" as const,
    source: {
      analytics: "umami" as const,
      searchConsoleSiteUrl: gsc.siteUrl,
      umamiWebsiteId: umami.source.websiteId,
      umamiWebsiteName: umami.source.websiteName,
    },
    request: {
      dateRange: { startDate, endDate },
      limit,
      searchConsoleTimeZone: "America/Los_Angeles",
      umamiTimeZone: umami.request.timeZone,
    },
    rowCount: returned.length,
    totalCandidateRows: candidates.length,
    rows: returned,
    scoring: {
      formula: OPPORTUNITY_SCORE_FORMULA,
      businessValueMetric: "nonBounceRate",
      engagementFallback: true,
      scoreDataLimited: umami.detail === "basic",
    },
    organicDetection: umami.organicDetection,
    coverage: {
      gscRowsConsidered: gsc.rows.length,
      umamiRowsConsidered: umami.rows.length,
      matchedRows: joined.length,
      unmatchedGscRows: candidates.length - joined.length,
      unmatchedUmamiRows: [...umamiByPath.keys()].filter(
        (path) => !joinedPaths.has(path),
      ).length,
    },
    truncated: {
      gsc: gsc.rows.length >= GSC_ROW_LIMIT,
      umami: umami.rows.length >= UMAMI_ROW_LIMIT,
      candidates: returned.length < candidates.length,
    },
    warnings: ["source_time_zones_differ"],
    reportMetadata: { analytics: "umami", detail: umami.detail },
  };
}

export const UmamiSearchOpportunityService = { getOpportunities };
