import { z } from "zod";
import type { UmamiClient, UmamiFilters } from "./umamiClient";
import { UmamiApiError } from "./umamiErrors";
import { bucketDay, numeric, pagedSchema, parseAnswer } from "./umamiResponses";

// Umami's report endpoints (POST /reports/:type) and the event-data reads.
// Report answers vary between versions and databases, so every schema is
// loose: unknown fields pass, and a missing optional field reads as empty.

type ReportRange = {
  websiteId: string;
  startAt: number;
  endAt: number;
  filters: UmamiFilters;
};

const nullableNumber = numeric.nullable().catch(null);
const label = z.string().nullable().catch(null);

const funnelSchema = z.array(
  z.looseObject({
    type: z.string().catch(""),
    value: z.string().catch(""),
    visitors: numeric.catch(0),
    previous: nullableNumber.optional(),
    dropped: nullableNumber.optional(),
    dropoff: nullableNumber.optional(),
    remaining: nullableNumber.optional(),
  }),
);

const journeySchema = z.array(
  z.looseObject({
    items: z.array(z.string().nullable()).catch([]),
    count: numeric.catch(0),
  }),
);

const namedValues = z
  .array(z.looseObject({ name: label, value: numeric.catch(0) }))
  .catch([]);

const attributionSchema = z.looseObject({
  referrer: namedValues,
  paidAds: namedValues,
  utm_source: namedValues,
  utm_medium: namedValues,
  utm_campaign: namedValues,
  utm_content: namedValues,
  utm_term: namedValues,
  total: z
    .looseObject({
      pageviews: numeric.catch(0),
      visitors: numeric.catch(0),
      visits: numeric.catch(0),
    })
    .nullable()
    .catch(null),
});

const utmRows = z
  .array(z.looseObject({ utm: label, views: numeric.catch(0) }))
  .catch([]);

const utmSchema = z.looseObject({
  utm_source: utmRows,
  utm_medium: utmRows,
  utm_campaign: utmRows,
  utm_content: utmRows,
  utm_term: utmRows,
});

const percentiles = z
  .looseObject({
    p50: nullableNumber,
    p75: nullableNumber,
    p95: nullableNumber,
  })
  .nullable()
  .catch(null);

const percentileRows = z
  .array(
    z.looseObject({
      name: label,
      p50: nullableNumber,
      p75: nullableNumber,
      p95: nullableNumber,
      count: numeric.catch(0),
    }),
  )
  .catch([]);

const performanceSchema = z.looseObject({
  summary: z
    .looseObject({
      lcp: percentiles,
      inp: percentiles,
      cls: percentiles,
      fcp: percentiles,
      ttfb: percentiles,
      count: numeric.catch(0),
    })
    .nullable()
    .catch(null),
  pages: percentileRows,
  devices: percentileRows,
  browsers: percentileRows,
});

const savedReportSchema = z.looseObject({
  id: z.string(),
  name: z.string().catch(""),
  type: z.string().catch(""),
  description: z.string().nullable().catch(null),
  parameters: z.unknown(),
});

const scalar = z
  .union([z.string(), z.number(), z.boolean()])
  .nullable()
  .optional()
  .catch(null);

const eventDataSchema = z.array(
  z.looseObject({
    eventName: z.string().nullable().optional(),
    propertyName: z.string().nullable().catch(null),
    // `event-data/events` names the value `propertyValue`;
    // `event-data/fields` names it `value`.
    propertyValue: scalar,
    value: scalar,
    total: numeric.catch(0),
  }),
);

const eventSeriesSchema = z.array(
  z.looseObject({
    x: z.string().nullable().catch(null),
    t: z.union([z.string(), z.number()]).optional(),
    y: numeric.catch(0),
  }),
);

export type FunnelStep = { type: "path" | "event"; value: string };

/** Report failures that mean "this instance can't run that report": the
 *  route is missing (older Umami) or it rejected the parameters, or the
 *  answer had a shape this client doesn't know. */
export function isUnavailableReport(error: unknown): boolean {
  return (
    error instanceof UmamiApiError &&
    (error.status === 400 ||
      error.status === 404 ||
      error.status === 405 ||
      (error.kind === "other" && error.status === null))
  );
}

function runReport<T>(
  client: UmamiClient,
  type: string,
  schema: z.ZodType<T>,
  range: ReportRange,
  parameters: Record<string, unknown> = {},
): Promise<T> {
  return client
    .post(`reports/${type}`, {
      websiteId: range.websiteId,
      type,
      // The same `field: "op.value"` filters the GET endpoints take.
      filters: range.filters,
      parameters: {
        startDate: new Date(range.startAt).toISOString(),
        endDate: new Date(range.endAt).toISOString(),
        ...parameters,
      },
    })
    .then((answer) => parseAnswer(schema, answer, `${type} report`));
}

/** Visitors reaching each step, in order, within `windowMinutes` of the
 *  previous one. */
export function getFunnel(
  client: UmamiClient,
  range: ReportRange,
  input: { steps: FunnelStep[]; windowMinutes: number },
) {
  return runReport(client, "funnel", funnelSchema, range, {
    steps: input.steps,
    window: input.windowMinutes,
  });
}

/** The most common sequences of pages and events (at most 100). */
export function getJourney(
  client: UmamiClient,
  range: ReportRange,
  input: { steps: number; startStep?: string; endStep?: string },
) {
  return runReport(client, "journey", journeySchema, range, input);
}

/** Which referrers, paid ads and UTM values led to a page or event. */
export function getAttribution(
  client: UmamiClient,
  range: ReportRange,
  input: { model: "first-click" | "last-click"; step: FunnelStep },
) {
  return runReport(client, "attribution", attributionSchema, range, {
    model: input.model,
    type: input.step.type,
    step: input.step.value,
  });
}

/** Pageviews per UTM source, medium, campaign, content and term. */
export function getUtmReport(client: UmamiClient, range: ReportRange) {
  return runReport(client, "utm", utmSchema, range);
}

/** Web Vitals percentiles, overall and per page, device and browser. */
export function getPerformance(client: UmamiClient, range: ReportRange) {
  return runReport(client, "performance", performanceSchema, range, {
    metric: "lcp",
    unit: "day",
    timezone: "UTC",
  });
}

/** The reports saved on the website in Umami (funnels, journeys...). */
export async function listSavedReports(client: UmamiClient, websiteId: string) {
  const answer = parseAnswer(
    pagedSchema(savedReportSchema),
    await client.get("reports", { websiteId, pageSize: 100 }),
    "saved report list",
  );
  return Array.isArray(answer) ? answer : answer.data;
}

/** Property values recorded with one custom event: `event-data/events` for
 *  that event, or `event-data/fields` filtered to it where the first is
 *  missing. */
export async function getEventData(
  client: UmamiClient,
  range: ReportRange,
  event: string,
) {
  const path = `websites/${encodeURIComponent(range.websiteId)}/event-data`;
  const query = {
    startAt: range.startAt,
    endAt: range.endAt,
    ...range.filters,
  };
  let answer: unknown;
  try {
    answer = await client.get(`${path}/events`, { ...query, event });
  } catch (error) {
    if (!isUnavailableReport(error)) throw error;
    answer = await client.get(`${path}/fields`, {
      ...query,
      event: `eq.${event}`,
    });
  }
  return parseAnswer(eventDataSchema, answer, "event data");
}

/** Daily counts of the top custom events. */
export async function getEventSeries(
  client: UmamiClient,
  range: ReportRange,
  limit: number,
) {
  const rows = parseAnswer(
    eventSeriesSchema,
    await client.get(
      `websites/${encodeURIComponent(range.websiteId)}/events/series`,
      {
        startAt: range.startAt,
        endAt: range.endAt,
        ...range.filters,
        unit: "day",
        timezone: "UTC",
        limit,
      },
    ),
    "event series",
  );
  return rows.flatMap((row) => {
    const date = bucketDay({ x: undefined, t: row.t, y: row.y });
    return date && row.x ? [{ event: row.x, date, count: row.y }] : [];
  });
}
