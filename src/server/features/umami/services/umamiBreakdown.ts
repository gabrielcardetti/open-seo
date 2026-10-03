import type { ConnectedUmami } from "@/server/features/umami/umamiAccess";
import type {
  UmamiExpandedRow,
  UmamiFilters,
  UmamiTotals,
} from "@/server/lib/umami/umamiClient";
import { UmamiApiError } from "@/server/lib/umami/umamiErrors";

// Per-row Umami breakdowns (pages, entry pages, referrers…) and the rates
// derived from Umami's totals.

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0
    ? Math.round((numerator / denominator) * 10_000) / 10_000
    : null;
}

/** Umami's totals with the rates its dashboard shows. */
export function summarize(totals: UmamiTotals) {
  return {
    visitors: totals.visitors,
    visits: totals.visits,
    pageviews: totals.pageviews,
    bounces: totals.bounces,
    bounceRate: ratio(totals.bounces, totals.visits),
    avgVisitSeconds:
      totals.visits > 0 ? Math.round(totals.totaltime / totals.visits) : null,
    viewsPerVisit: ratio(totals.pageviews, totals.visits),
  };
}

// Basic rows (pre-Umami 3) carry only `count`; expanded rows everything else.
export type BreakdownRow = {
  [Key in keyof ReturnType<typeof summarize>]: number | null;
} & { name: string; count: number | null };

// Path rows fetched to give entry pages their engagement.
const ENGAGEMENT_PATH_ROWS = 500;

/**
 * Visitors, visits, views, bounces and time per value of `type`. Instances
 * older than Umami 3 have no expanded metrics; they answer the single count
 * Umami ranks by, returned as `count` with the other fields null.
 */
export async function breakdownRows(
  { client, connection }: ConnectedUmami,
  request: {
    type: string;
    startAt: number;
    endAt: number;
    filters: UmamiFilters;
    limit: number;
    offset: number;
    search?: string;
  },
): Promise<{
  rows: BreakdownRow[];
  detail: "expanded" | "basic";
}> {
  const query = { websiteId: connection.websiteId, ...request };
  let expanded: UmamiExpandedRow[];
  try {
    expanded = await client.getExpandedMetrics(query);
  } catch (error) {
    if (
      !(error instanceof UmamiApiError) ||
      (error.status !== 400 && error.status !== 404)
    ) {
      throw error;
    }
    const basic = await client.getMetrics(query);
    return {
      detail: "basic",
      rows: basic.map((row) => ({
        name: row.name,
        visitors: null,
        visits: null,
        pageviews: null,
        bounces: null,
        bounceRate: null,
        avgVisitSeconds: null,
        viewsPerVisit: null,
        count: row.value,
      })),
    };
  }
  const rows: BreakdownRow[] = expanded.map(({ name, ...totals }) => ({
    name,
    ...summarize(totals),
    count: null,
  }));
  if (request.type !== "entry") return { detail: "expanded", rows };

  // Umami 3 scores entry pages as single-view visits: every entry row comes
  // back with bounces equal to visits and no time. The same visits read per
  // path carry the real engagement (visits that viewed the page, how many
  // bounced, time spent), so entry pages keep their own visit counts and take
  // bounce rate, time and views per visit from the matching path row.
  const paths = await client.getExpandedMetrics({
    ...query,
    type: "path",
    limit: Math.max(ENGAGEMENT_PATH_ROWS, request.limit + request.offset),
    offset: 0,
  });
  const engagementByPath = new Map(
    paths.map(({ name, ...totals }) => [name, summarize(totals)] as const),
  );
  return {
    detail: "expanded",
    rows: rows.map((row) => {
      const engagement = engagementByPath.get(row.name);
      return {
        ...row,
        bounces: null,
        bounceRate: engagement?.bounceRate ?? null,
        avgVisitSeconds: engagement?.avgVisitSeconds ?? null,
        viewsPerVisit: engagement?.viewsPerVisit ?? null,
      };
    }),
  };
}
