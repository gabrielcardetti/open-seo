import { sort } from "remeda";
import type { ConnectedUmami } from "@/server/features/umami/umamiAccess";
import {
  breakdownRows,
  summarize,
} from "@/server/features/umami/services/umamiBreakdown";
import {
  AI_ASSISTANTS,
  aiAssistantOfHost,
  aiAssistantOfUtmSource,
  SEARCH_ENGINES,
  searchEngineOf,
} from "@/server/features/umami/umamiSources";
import {
  campaignTuples,
  UTM_FIELDS,
  type UtmField,
} from "@/server/features/umami/umamiCampaigns";
import { sourceAndRequest, withUmami } from "@/server/features/umami/umamiRead";
import {
  resolveUmamiRange,
  TIME_ZONE,
  type UmamiRange,
} from "@/server/features/umami/umamiScope";
import type { UmamiFilters, UmamiTotals } from "@/server/lib/umami/umamiClient";
import { UmamiApiError } from "@/server/lib/umami/umamiErrors";
import {
  getUtmReport,
  isUnavailableReport,
} from "@/server/lib/umami/umamiReports";

// Where visits come from beyond Umami's own channels: search engines, AI
// assistants and UTM campaigns.

type RangeRead = { projectId: string; startDate: string; endDate: string };

const MAX_REFERRER_ROWS = 500;
const MAX_QUERY_ROWS = 500;
const MAX_COMBINATIONS = 100;
const DETAIL_ROWS = 10;

const ZERO: UmamiTotals = {
  pageviews: 0,
  visitors: 0,
  visits: 0,
  bounces: 0,
  totaltime: 0,
};

function addTotals(a: UmamiTotals, b: UmamiTotals): UmamiTotals {
  return {
    pageviews: a.pageviews + b.pageviews,
    visitors: a.visitors + b.visitors,
    visits: a.visits + b.visits,
    bounces: a.bounces + b.bounces,
    totaltime: a.totaltime + b.totaltime,
  };
}

/** Referrer domains with their totals. Instances older than Umami 3 answer
 *  one count per domain (Umami's visit count), kept as visits. */
async function referrerTotals(
  { client, connection, hostFilter }: ConnectedUmami,
  startAt: number,
  endAt: number,
): Promise<Array<{ name: string } & UmamiTotals>> {
  const request = {
    websiteId: connection.websiteId,
    startAt,
    endAt,
    type: "referrer",
    limit: MAX_REFERRER_ROWS,
    filters: hostFilter,
  };
  try {
    return await client.getExpandedMetrics(request);
  } catch (error) {
    if (
      !(error instanceof UmamiApiError) ||
      (error.status !== 400 && error.status !== 404)
    ) {
      throw error;
    }
    const rows = await client.getMetrics(request);
    return rows.map((row) => ({ ...ZERO, name: row.name, visits: row.value }));
  }
}

/** The UTM report, or null when this Umami can't run it. */
async function utmReportOrNull(umami: ConnectedUmami, range: UmamiRange) {
  try {
    return await getUtmReport(umami.client, {
      websiteId: umami.connection.websiteId,
      startAt: range.startAt,
      endAt: range.endAt,
      filters: umami.hostFilter,
    });
  } catch (error) {
    if (isUnavailableReport(error)) return null;
    throw error;
  }
}

/** Visits referred by each search engine, against the previous period. */
async function getSearchEngines(input: RangeRead) {
  return withUmami(input.projectId, async (umami) => {
    const range = resolveUmamiRange(input);
    const [current, previous] = await Promise.all([
      referrerTotals(umami, range.startAt, range.endAt),
      referrerTotals(umami, range.previousStartAt, range.previousEndAt),
    ]);
    const group = (rows: typeof current) => {
      const byEngine = new Map<string, UmamiTotals & { domains: string[] }>();
      for (const { name, ...totals } of rows) {
        const engine = searchEngineOf(name);
        if (!engine) continue;
        const sum = byEngine.get(engine) ?? { ...ZERO, domains: [] };
        byEngine.set(engine, {
          ...addTotals(sum, totals),
          domains: [...sum.domains, name],
        });
      }
      return byEngine;
    };
    const now = group(current);
    const before = group(previous);
    const engines = SEARCH_ENGINES.flatMap((engine) => {
      const totals = now.get(engine);
      const prev = before.get(engine);
      if (!totals && !prev) return [];
      return [
        {
          engine,
          ...summarize(totals ?? ZERO),
          previousVisits: prev?.visits ?? 0,
          domains: totals?.domains ?? [],
        },
      ];
    });
    return {
      ...sourceAndRequest(umami, range, {}),
      engines: sort(engines, (a, b) => b.visits - a.visits),
    };
  });
}

/**
 * Traffic from AI assistants, seen two ways that can overlap: the referrer
 * host (chatgpt.com, perplexity.ai...) and the utm_source the assistant or the
 * site put on the link (ChatGPT appends utm_source=chatgpt.com). Visits only
 * count once per method; a visit carrying both shows in both columns.
 */
async function getAiReferrals(input: RangeRead) {
  return withUmami(input.projectId, async (umami) => {
    const range = resolveUmamiRange(input);
    const websiteId = umami.connection.websiteId;
    const [referrers, utm] = await Promise.all([
      referrerTotals(umami, range.startAt, range.endAt),
      utmReportOrNull(umami, range),
    ]);
    const hosts = referrers.filter((row) => aiAssistantOfHost(row.name));
    const sources = (utm?.utm_source ?? []).flatMap((row) =>
      row.utm && aiAssistantOfUtmSource(row.utm)
        ? [{ source: row.utm, views: row.views }]
        : [],
    );
    const assistants = AI_ASSISTANTS.flatMap((assistant) => {
      const own = hosts.filter(
        (row) => aiAssistantOfHost(row.name) === assistant,
      );
      const tagged = sources.filter(
        (row) => aiAssistantOfUtmSource(row.source) === assistant,
      );
      if (own.length === 0 && tagged.length === 0) return [];
      const totals = own.reduce<UmamiTotals>(addTotals, ZERO);
      return [
        {
          assistant,
          referredVisits: totals.visits,
          referredVisitors: totals.visitors,
          referredBounceRate: summarize(totals).bounceRate,
          taggedViews: tagged.reduce((sum, row) => sum + row.views, 0),
          hosts: own.map((row) => row.name),
          utmSources: tagged.map((row) => row.source),
        },
      ];
    });

    const segments = {
      referred:
        hosts.length > 0
          ? { referrer: `eq.${hosts.map((row) => row.name).join(",")}` }
          : null,
      tagged:
        sources.length > 0
          ? { utmSource: `eq.${sources.map((row) => row.source).join(",")}` }
          : null,
    };
    const read = async (segment: UmamiFilters | null) => {
      if (!segment) return null;
      const filters = { ...umami.hostFilter, ...segment };
      const request = { websiteId, startAt: range.startAt, endAt: range.endAt };
      const [series, entries] = await Promise.all([
        umami.client.getPageviewSeries({
          ...request,
          filters,
          unit: "day",
          timezone: TIME_ZONE,
        }),
        umami.client.getMetrics({
          ...request,
          filters,
          type: "entry",
          limit: DETAIL_ROWS * 2,
        }),
      ]);
      return { series: series.sessions, entries };
    };
    const [referred, tagged] = await Promise.all([
      read(segments.referred),
      read(segments.tagged),
    ]);

    const landing = new Map<string, { referred: number; tagged: number }>();
    for (const row of referred?.entries ?? []) {
      landing.set(row.name, { referred: row.value, tagged: 0 });
    }
    for (const row of tagged?.entries ?? []) {
      const existing = landing.get(row.name) ?? { referred: 0, tagged: 0 };
      landing.set(row.name, { ...existing, tagged: row.value });
    }
    const days = new Map<string, { referred: number; tagged: number }>();
    for (const point of referred?.series ?? []) {
      days.set(point.date, { referred: point.value, tagged: 0 });
    }
    for (const point of tagged?.series ?? []) {
      const existing = days.get(point.date) ?? { referred: 0, tagged: 0 };
      days.set(point.date, { ...existing, tagged: point.value });
    }

    return {
      ...sourceAndRequest(umami, range, {}),
      utmReportAvailable: utm !== null,
      assistants: sort(
        assistants,
        (a, b) =>
          b.referredVisits + b.taggedViews - (a.referredVisits + a.taggedViews),
      ),
      landingPages: sort(
        [...landing].map(([path, counts]) => ({ path, ...counts })),
        (a, b) => b.referred + b.tagged - (a.referred + a.tagged),
      ).slice(0, DETAIL_ROWS * 2),
      trend: sort(
        [...days].map(([date, counts]) => ({ date, ...counts })),
        (a, b) => a.date.localeCompare(b.date),
      ),
    };
  });
}

/**
 * UTM campaigns: pageviews per source, medium, campaign, content and term
 * (Umami's UTM report), and the source / medium / campaign combinations
 * parsed from the landing URLs' query strings, counted in visits.
 */
async function getCampaigns(input: RangeRead) {
  return withUmami(input.projectId, async (umami) => {
    const range = resolveUmamiRange(input);
    const [report, queries] = await Promise.all([
      utmReportOrNull(umami, range),
      umami.client.getMetrics({
        websiteId: umami.connection.websiteId,
        startAt: range.startAt,
        endAt: range.endAt,
        type: "query",
        limit: MAX_QUERY_ROWS,
        filters: umami.hostFilter,
      }),
    ]);
    return {
      ...sourceAndRequest(umami, range, {}),
      utmReportAvailable: report !== null,
      fields: UTM_FIELDS.map((field) => ({
        field,
        rows: (report?.[field] ?? []).flatMap((row) =>
          row.utm ? [{ value: row.utm, views: row.views }] : [],
        ),
      })),
      combinations: campaignTuples(queries, MAX_COMBINATIONS),
    };
  });
}

// Umami's filter names for the UTM fields.
const UTM_FILTERS: Record<UtmField, string> = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_content: "utmContent",
  utm_term: "utmTerm",
};

/** One UTM value's totals, landing pages and custom events. */
async function getCampaignDetail(
  input: RangeRead & { field: UtmField; value: string },
) {
  return withUmami(input.projectId, async (umami) => {
    const range = resolveUmamiRange(input);
    const filters: UmamiFilters = {
      ...umami.hostFilter,
      // `eq.` splits on commas, so a value with a comma can't be matched
      // whole; `c.` (contains) keeps it one value.
      [UTM_FILTERS[input.field]]: input.value.includes(",")
        ? `c.${input.value}`
        : `eq.${input.value}`,
    };
    const request = {
      websiteId: umami.connection.websiteId,
      startAt: range.startAt,
      endAt: range.endAt,
      filters,
    };
    const [stats, landing, events] = await Promise.all([
      umami.client.getStats(request),
      breakdownRows(umami, {
        ...request,
        type: "entry",
        limit: DETAIL_ROWS,
        offset: 0,
      }),
      umami.client.getMetrics({
        ...request,
        type: "event",
        limit: DETAIL_ROWS,
      }),
    ]);
    return {
      ...sourceAndRequest(umami, range, {
        field: input.field,
        value: input.value,
      }),
      totals: summarize(stats.current),
      landingPages: landing.rows,
      events: events.map((row) => ({ event: row.name, count: row.value })),
    };
  });
}

export const UmamiInsightsService = {
  getSearchEngines,
  getAiReferrals,
  getCampaigns,
  getCampaignDetail,
};
