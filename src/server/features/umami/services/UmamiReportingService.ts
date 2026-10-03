import { shiftGa4Date } from "@/server/features/ga4/services/Ga4Dates";
import {
  openUmamiForProject,
  recordUmamiFailure,
  type ConnectedUmami,
} from "@/server/features/umami/umamiAccess";
import type {
  UmamiExpandedRow,
  UmamiFilters,
  UmamiTotals,
} from "@/server/lib/umami/umamiClient";
import { UmamiApiError } from "@/server/lib/umami/umamiErrors";
import {
  channelFilters,
  resolveUmamiRange,
  TIME_ZONE,
  type RangeInput,
  type UmamiChannel,
  type UmamiRange,
} from "@/server/features/umami/umamiScope";

type PageInput = RangeInput & {
  projectId: string;
  limit: number;
  offset: number;
};

const ZERO_TOTALS: UmamiTotals = {
  pageviews: 0,
  visitors: 0,
  visits: 0,
  bounces: 0,
  totaltime: 0,
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0
    ? Math.round((numerator / denominator) * 10_000) / 10_000
    : null;
}

/** Umami's totals with the rates its dashboard shows. */
function summarize(totals: UmamiTotals) {
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
type BreakdownRow = {
  [Key in keyof ReturnType<typeof summarize>]: number | null;
} & { name: string; count: number | null };

function sourceOf({ connection }: ConnectedUmami) {
  return {
    analytics: "umami" as const,
    mode: connection.mode,
    websiteId: connection.websiteId,
    websiteName: connection.websiteName,
    websiteDomain: connection.websiteDomain,
  };
}

/** Open the project's Umami website, run a read, and remember a failure the
 *  user has to fix (bad credentials, a deleted website). */
async function withUmami<T>(
  projectId: string,
  read: (umami: ConnectedUmami) => Promise<T>,
): Promise<T> {
  const umami = await openUmamiForProject(projectId);
  try {
    return await read(umami);
  } catch (error) {
    await recordUmamiFailure(projectId, error).catch(() => undefined);
    throw error;
  }
}

/**
 * Visitors, visits, views, bounces and time per value of `type`. Instances
 * older than Umami 3 have no expanded metrics; they answer the single count
 * Umami ranks by, returned as `count` with the other fields null.
 */
async function breakdownRows(
  { client, connection }: ConnectedUmami,
  request: {
    type: string;
    startAt: number;
    endAt: number;
    filters: UmamiFilters;
    limit: number;
    offset: number;
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
  return {
    detail: "expanded",
    rows: expanded.map(({ name, ...totals }) => ({
      name,
      ...summarize(totals),
      count: null,
    })),
  };
}

/** Each row with the same name's previous-period values (null when the name
 *  had none), when a comparison was asked for. */
function withPreviousRows(
  rows: BreakdownRow[],
  previousRows: BreakdownRow[] | null,
): Array<BreakdownRow & { previous?: BreakdownRow | null }> {
  if (!previousRows) return rows;
  const byName = new Map(previousRows.map((row) => [row.name, row]));
  return rows.map((row) => ({
    ...row,
    previous: byName.get(row.name) ?? null,
  }));
}

/** A day-by-day trend with every day of the range present. */
function fillTrend(
  range: UmamiRange,
  series: {
    pageviews: { date: string; value: number }[];
    sessions: { date: string; value: number }[];
  },
) {
  const pageviews = new Map(series.pageviews.map((p) => [p.date, p.value]));
  const visitors = new Map(series.sessions.map((p) => [p.date, p.value]));
  const days: Array<{ date: string; visitors: number; pageviews: number }> = [];
  for (
    let date = range.startDate;
    date <= range.endDate;
    date = shiftGa4Date(date, 1)
  ) {
    days.push({
      date,
      visitors: visitors.get(date) ?? 0,
      pageviews: pageviews.get(date) ?? 0,
    });
  }
  return days;
}

/** Top-line totals vs the previous period, plus a daily trend. */
async function getOverview(
  input: RangeInput & { projectId: string; channel: UmamiChannel },
) {
  return withUmami(input.projectId, async (umami) => {
    const range = resolveUmamiRange(input);
    const { filters, organicDetection } = await channelFilters(
      umami,
      input.channel,
      range,
    );
    const base = {
      ...sourceAndRequest(umami, range, { channel: input.channel }),
      organicDetection,
    };
    if (!filters) {
      return {
        ...base,
        current: summarize(ZERO_TOTALS),
        previous: summarize(ZERO_TOTALS),
        trend: fillTrend(range, { pageviews: [], sessions: [] }),
      };
    }
    const websiteId = umami.connection.websiteId;
    const [stats, series] = await Promise.all([
      umami.client.getStats({
        websiteId,
        startAt: range.startAt,
        endAt: range.endAt,
        filters,
      }),
      umami.client.getPageviewSeries({
        websiteId,
        startAt: range.startAt,
        endAt: range.endAt,
        filters,
        unit: "day",
        timezone: TIME_ZONE,
      }),
    ]);
    const previous =
      stats.previous ??
      (
        await umami.client.getStats({
          websiteId,
          startAt: range.previousStartAt,
          endAt: range.previousEndAt,
          filters,
        })
      ).current;
    return {
      ...base,
      current: summarize(stats.current),
      previous: summarize(previous),
      trend: fillTrend(range, series),
    };
  });
}

/** The fields every read answers with: where the data came from and the
 *  resolved request. */
function sourceAndRequest<Extra extends Record<string, unknown>>(
  umami: ConnectedUmami,
  range: UmamiRange,
  extra: Extra,
) {
  return {
    ok: true as const,
    source: sourceOf(umami),
    request: {
      dateRange: { startDate: range.startDate, endDate: range.endDate },
      previousDateRange: {
        startDate: range.previousStartDate,
        endDate: range.previousEndDate,
      },
      timeZone: TIME_ZONE,
      ...extra,
    },
  };
}

/** A ranked breakdown with optional previous-period values per row. */
async function getBreakdown(
  input: PageInput & {
    type: string;
    channel: UmamiChannel;
    comparePreviousPeriod: boolean;
  },
) {
  return withUmami(input.projectId, async (umami) => {
    const range = resolveUmamiRange(input);
    const { filters, organicDetection } = await channelFilters(
      umami,
      input.channel,
      range,
    );
    const base = {
      ...sourceAndRequest(umami, range, {
        channel: input.channel,
        type: input.type,
        limit: input.limit,
        offset: input.offset,
        comparePreviousPeriod: input.comparePreviousPeriod,
      }),
      organicDetection,
    };
    if (!filters) {
      return { ...base, detail: "expanded" as const, rows: [], hasMore: false };
    }
    // Umami answers channels whole (about 15 rows) and ignores paging there.
    const pagedUpstream = input.type !== "channel";
    const page = {
      type: input.type,
      filters,
      limit: pagedUpstream ? input.limit : 100,
      offset: pagedUpstream ? input.offset : 0,
    };
    const [current, previous] = await Promise.all([
      breakdownRows(umami, {
        ...page,
        startAt: range.startAt,
        endAt: range.endAt,
      }),
      input.comparePreviousPeriod
        ? breakdownRows(umami, {
            ...page,
            // Rank the previous period over the same names, not its own top.
            limit: Math.max(page.limit * 2, 100),
            offset: 0,
            startAt: range.previousStartAt,
            endAt: range.previousEndAt,
          })
        : null,
    ]);
    const rows = pagedUpstream
      ? current.rows
      : current.rows.slice(input.offset, input.offset + input.limit);
    return {
      ...base,
      detail: current.detail,
      rows: withPreviousRows(rows, previous?.rows ?? null),
      hasMore: pagedUpstream
        ? current.rows.length >= input.limit
        : current.rows.length > input.offset + input.limit,
    };
  });
}

/** Custom event counts by event name (Umami's event metric). */
async function getEvents(
  input: PageInput & { channel: UmamiChannel; comparePreviousPeriod: boolean },
) {
  return withUmami(input.projectId, async (umami) => {
    const range = resolveUmamiRange(input);
    const { filters, organicDetection } = await channelFilters(
      umami,
      input.channel,
      range,
    );
    const base = {
      ...sourceAndRequest(umami, range, {
        channel: input.channel,
        limit: input.limit,
        offset: input.offset,
        comparePreviousPeriod: input.comparePreviousPeriod,
      }),
      organicDetection,
    };
    if (!filters) return { ...base, rows: [], hasMore: false };
    const websiteId = umami.connection.websiteId;
    const [current, previous] = await Promise.all([
      umami.client.getMetrics({
        websiteId,
        type: "event",
        filters,
        limit: input.limit,
        offset: input.offset,
        startAt: range.startAt,
        endAt: range.endAt,
      }),
      input.comparePreviousPeriod
        ? umami.client.getMetrics({
            websiteId,
            type: "event",
            filters,
            limit: Math.max(input.limit * 2, 100),
            startAt: range.previousStartAt,
            endAt: range.previousEndAt,
          })
        : null,
    ]);
    const previousByName = previous
      ? new Map(previous.map((row) => [row.name, row.value]))
      : null;
    return {
      ...base,
      rows: current.map((row) => ({
        event: row.name,
        count: row.value,
        ...(previousByName
          ? { previousCount: previousByName.get(row.name) ?? null }
          : {}),
      })),
      hasMore: current.length >= input.limit,
    };
  });
}

async function getRealtime(projectId: string) {
  return withUmami(projectId, async (umami) => ({
    ok: true as const,
    source: sourceOf(umami),
    activeVisitors: await umami.client.getActiveVisitors(
      umami.connection.websiteId,
    ),
    window: "Visitors seen in the last 5 minutes.",
  }));
}

/** Organic entry pages with visits, bounces and time — the Umami side of
 *  search opportunities. */
async function getOrganicEntryPages(input: {
  projectId: string;
  startDate: string;
  endDate: string;
  limit: number;
}) {
  return getBreakdown({
    ...input,
    offset: 0,
    type: "entry",
    channel: "organic_search",
    comparePreviousPeriod: false,
  });
}

export const UmamiReportingService = {
  getOverview,
  getBreakdown,
  getEvents,
  getRealtime,
  getOrganicEntryPages,
};
