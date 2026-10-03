import { sort } from "remeda";
import { z } from "zod";
import type { ConnectedUmami } from "@/server/features/umami/umamiAccess";
import { sourceAndRequest, withUmami } from "@/server/features/umami/umamiRead";
import {
  channelFilters,
  resolveUmamiRange,
  type UmamiChannel,
  type UmamiRange,
} from "@/server/features/umami/umamiScope";
import { AppError } from "@/server/lib/errors";
import {
  getAttribution,
  getEventData,
  getEventSeries,
  getFunnel,
  getJourney,
  getPerformance,
  isUnavailableReport,
  listSavedReports,
  type FunnelStep,
} from "@/server/lib/umami/umamiReports";

// Custom events, the reports Umami saves and runs (funnels, journeys,
// attribution) and Web Vitals.

type Read = {
  projectId: string;
  startDate?: string;
  endDate?: string;
  channel: UmamiChannel;
};

const SERIES_EVENTS = 10;
const MAX_PROPERTIES = 10;
const MAX_VALUES = 10;

const savedFunnelParameters = z.looseObject({
  steps: z
    .array(
      z.looseObject({
        type: z.enum(["path", "event"]),
        value: z.string().min(1),
      }),
    )
    .min(2),
  window: z.coerce.number().positive().optional().catch(undefined),
});

/** The range and the channel's filters as a report input, or null when the
 *  channel had no traffic (no search engine referred anyone). */
async function scope(umami: ConnectedUmami, input: Read) {
  const range = resolveUmamiRange(input);
  const { filters, organicDetection } = await channelFilters(
    umami,
    input.channel,
    range,
  );
  return {
    range,
    organicDetection,
    report: filters
      ? {
          websiteId: umami.connection.websiteId,
          startAt: range.startAt,
          endAt: range.endAt,
          filters,
        }
      : null,
  };
}

function header(
  umami: ConnectedUmami,
  range: UmamiRange,
  input: Read,
  organicDetection: Awaited<ReturnType<typeof scope>>["organicDetection"],
) {
  return {
    ...sourceAndRequest(umami, range, { channel: input.channel }),
    organicDetection,
  };
}

/** Runs a report, answering `available: false` when this Umami can't. */
async function orUnavailable<T>(run: () => Promise<T>) {
  try {
    return { available: true as const, result: await run() };
  } catch (error) {
    if (isUnavailableReport(error)) {
      return { available: false as const, result: null };
    }
    throw error;
  }
}

/** Daily counts of the top custom events. */
async function getEventTrend(input: Read) {
  return withUmami(input.projectId, async (umami) => {
    const { range, organicDetection, report } = await scope(umami, input);
    const points = report
      ? await getEventSeries(umami.client, report, SERIES_EVENTS)
      : [];
    return { ...header(umami, range, input, organicDetection), points };
  });
}

/**
 * One custom event's daily count and the properties recorded with it: at
 * most ten properties, each with its ten most frequent values.
 */
async function getEventDetail(input: Read & { event: string }) {
  return withUmami(input.projectId, async (umami) => {
    const { range, organicDetection, report } = await scope(umami, input);
    const base = header(umami, range, input, organicDetection);
    if (!report) {
      return {
        ...base,
        event: input.event,
        points: [],
        properties: [],
        moreProperties: 0,
      };
    }
    const eventReport = {
      ...report,
      filters: { ...report.filters, event: `eq.${input.event}` },
    };
    const [points, data] = await Promise.all([
      getEventSeries(umami.client, eventReport, 1),
      getEventData(umami.client, report, input.event),
    ]);
    const byProperty = new Map<string, Map<string, number>>();
    for (const row of data) {
      if (!row.propertyName) continue;
      if (row.eventName && row.eventName !== input.event) continue;
      const values =
        byProperty.get(row.propertyName) ?? new Map<string, number>();
      const raw = row.propertyValue ?? row.value;
      const value = raw === undefined || raw === null ? "(any)" : String(raw);
      values.set(value, (values.get(value) ?? 0) + row.total);
      byProperty.set(row.propertyName, values);
    }
    const properties = [...byProperty].map(([name, values]) => {
      const ranked = sort([...values], (a, b) => b[1] - a[1]);
      return {
        name,
        total: ranked.reduce((sum, [, count]) => sum + count, 0),
        values: ranked
          .slice(0, MAX_VALUES)
          .map(([value, count]) => ({ value, count })),
        moreValues: Math.max(0, ranked.length - MAX_VALUES),
      };
    });
    return {
      ...base,
      event: input.event,
      points: points.map(({ date, count }) => ({ date, count })),
      properties: sort(properties, (a, b) => b.total - a.total).slice(
        0,
        MAX_PROPERTIES,
      ),
      moreProperties: Math.max(0, properties.length - MAX_PROPERTIES),
    };
  });
}

/** The reports saved on the website in Umami, with each funnel's steps. */
async function getSavedReports(projectId: string) {
  return withUmami(projectId, async (umami) => {
    const saved = await orUnavailable(() =>
      listSavedReports(umami.client, umami.connection.websiteId),
    );
    return {
      ok: true as const,
      available: saved.available,
      reports: (saved.result ?? []).map((report) => {
        const funnel =
          report.type === "funnel"
            ? savedFunnelParameters.safeParse(report.parameters)
            : null;
        return {
          id: report.id,
          name: report.name,
          type: report.type,
          description: report.description,
          funnel: funnel?.success
            ? {
                steps: funnel.data.steps.map(({ type, value }) => ({
                  type,
                  value,
                })),
                windowMinutes: funnel.data.window ?? null,
              }
            : null,
        };
      }),
    };
  });
}

/**
 * A funnel over the range: a saved Umami funnel (its steps and window) or
 * steps given here. Each step reports the visitors who reached it, how many
 * the previous step lost, and the share of the first step remaining.
 */
async function runFunnel(
  input: Read & {
    windowMinutes: number;
  } & ({ reportId: string } | { steps: FunnelStep[] }),
) {
  return withUmami(input.projectId, async (umami) => {
    let steps: FunnelStep[];
    let windowMinutes = input.windowMinutes;
    let savedName: string | null = null;
    if ("reportId" in input) {
      const saved = (
        await listSavedReports(umami.client, umami.connection.websiteId)
      ).find((report) => report.id === input.reportId);
      const parameters = savedFunnelParameters.safeParse(saved?.parameters);
      if (!saved || saved.type !== "funnel" || !parameters.success) {
        throw new AppError("NOT_FOUND", "That saved funnel no longer exists.");
      }
      steps = parameters.data.steps.map(({ type, value }) => ({ type, value }));
      windowMinutes = parameters.data.window ?? windowMinutes;
      savedName = saved.name;
    } else {
      steps = input.steps;
    }
    const { range, organicDetection, report } = await scope(umami, input);
    const run = await orUnavailable(async () =>
      report ? getFunnel(umami.client, report, { steps, windowMinutes }) : [],
    );
    const counts = steps.map((_, index) => run.result?.[index]?.visitors ?? 0);
    const first = counts[0] ?? 0;
    return {
      ...header(umami, range, input, organicDetection),
      available: run.available,
      savedName,
      windowMinutes,
      steps: steps.map((step, index) => {
        const visitors = counts[index] ?? 0;
        const previous = index > 0 ? (counts[index - 1] ?? 0) : null;
        return {
          ...step,
          visitors,
          dropped: previous === null ? null : Math.max(0, previous - visitors),
          dropoffRate:
            previous === null || previous === 0
              ? null
              : 1 - visitors / previous,
          remainingRate: first > 0 ? visitors / first : null,
        };
      }),
    };
  });
}

/** The most common paths through pages and events (Umami's journey report). */
async function runJourney(
  input: Read & { steps: number; startStep?: string; endStep?: string },
) {
  return withUmami(input.projectId, async (umami) => {
    const { range, organicDetection, report } = await scope(umami, input);
    const run = await orUnavailable(async () =>
      report
        ? getJourney(umami.client, report, {
            steps: input.steps,
            startStep: input.startStep,
            endStep: input.endStep,
          })
        : [],
    );
    return {
      ...header(umami, range, input, organicDetection),
      available: run.available,
      paths: (run.result ?? []).slice(0, 50).map((row) => ({
        steps: row.items.filter((item): item is string => Boolean(item)),
        count: row.count,
      })),
    };
  });
}

/** Named rows of a report, without the unnamed (direct / none) bucket. */
function namedRows(values: Array<{ name: string | null; value: number }>) {
  return values.flatMap((row) =>
    row.name ? [{ name: row.name, visits: row.value }] : [],
  );
}

/** Which referrers, paid ads and UTM values led visitors to a page or event,
 *  crediting the first or the last touch. */
async function runAttribution(
  input: Read & { model: "first_click" | "last_click"; step: FunnelStep },
) {
  return withUmami(input.projectId, async (umami) => {
    const { range, organicDetection, report } = await scope(umami, input);
    const run = await orUnavailable(async () =>
      report
        ? getAttribution(umami.client, report, {
            model: input.model === "first_click" ? "first-click" : "last-click",
            step: input.step,
          })
        : null,
    );
    const result = run.result;
    return {
      ...header(umami, range, input, organicDetection),
      available: run.available,
      model: input.model,
      step: input.step,
      total: result?.total
        ? {
            pageviews: result.total.pageviews,
            visitors: result.total.visitors,
            visits: result.total.visits,
          }
        : null,
      referrers: namedRows(result?.referrer ?? []),
      paidAds: namedRows(result?.paidAds ?? []),
      utmSources: namedRows(result?.utm_source ?? []),
      utmMediums: namedRows(result?.utm_medium ?? []),
      utmCampaigns: namedRows(result?.utm_campaign ?? []),
    };
  });
}

// Web Vitals thresholds (good up to the first number, poor above the second),
// as Google's Core Web Vitals and Lighthouse define them. Times in ms.
const VITAL_THRESHOLDS = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
} as const;
const VITALS = ["lcp", "inp", "cls", "fcp", "ttfb"] as const;
type Vital = (typeof VITALS)[number];

function rate(
  metric: Vital,
  value: number | null,
): "good" | "needs_improvement" | "poor" | null {
  if (value === null) return null;
  const [good, poor] = VITAL_THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "needs_improvement" : "poor";
}

/** Web Vitals at p50/p75/p95 with a rating of the p75, overall and by page,
 *  device and browser. Empty unless the site's Umami script sends them. */
async function getWebVitals(input: Read) {
  return withUmami(input.projectId, async (umami) => {
    const { range, organicDetection, report } = await scope(umami, input);
    const run = await orUnavailable(async () =>
      report ? getPerformance(umami.client, report) : null,
    );
    const summary = run.result?.summary ?? null;
    const sampleCount = summary?.count ?? 0;
    const metrics = VITALS.map((metric) => {
      const values = summary?.[metric] ?? null;
      const p75 = values?.p75 ?? null;
      return {
        metric,
        p50: values?.p50 ?? null,
        p75,
        p95: values?.p95 ?? null,
        rating: sampleCount > 0 ? rate(metric, p75) : null,
        thresholds: VITAL_THRESHOLDS[metric],
      };
    });
    const lcpRows = (
      rows: Array<{
        name: string | null;
        p50: number | null;
        p75: number | null;
        p95: number | null;
        count: number;
      }>,
    ) =>
      rows.flatMap((row) =>
        row.name
          ? [{ ...row, name: row.name, rating: rate("lcp", row.p75) }]
          : [],
      );
    return {
      ...header(umami, range, input, organicDetection),
      available: run.available,
      hasData: sampleCount > 0,
      sampleCount,
      metrics,
      // Umami breaks pages, devices and browsers down by one metric: LCP.
      breakdownMetric: "lcp" as const,
      pages:
        sampleCount > 0 ? lcpRows(run.result?.pages ?? []).slice(0, 100) : [],
      devices: sampleCount > 0 ? lcpRows(run.result?.devices ?? []) : [],
      browsers:
        sampleCount > 0 ? lcpRows(run.result?.browsers ?? []).slice(0, 20) : [],
    };
  });
}

export const UmamiConversionService = {
  getEventTrend,
  getEventDetail,
  getSavedReports,
  runFunnel,
  runJourney,
  runAttribution,
  getWebVitals,
};
