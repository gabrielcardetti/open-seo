/**
 * Google's public performance APIs, read with one Google Cloud API key:
 * the Chrome UX Report (CrUX) for real-Chrome-user field data, its History
 * API for the weekly trend, and PageSpeed Insights for a Lighthouse run plus
 * the same field data. The key goes in the X-Goog-Api-Key header, never in
 * the URL, so it stays out of logs.
 */
import { z } from "zod";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import type {
  RawLighthouseAudit,
  RawLighthouseCategory,
} from "@/server/lib/lighthouseStoredPayload";

const CRUX_BASE = "https://chromeuxreport.googleapis.com/v1/records";
const PAGESPEED_URL =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CRUX_TIMEOUT_MS = 15_000;
// A PageSpeed run loads the page in Lighthouse; it routinely takes 20-40 s.
const PAGESPEED_TIMEOUT_MS = 90_000;

export type CruxFormFactor = "PHONE" | "DESKTOP" | "ALL";
export type CruxTarget = { origin: string } | { url: string };

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const googleErrorSchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
});

async function googleFetch(
  url: string,
  apiKey: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<unknown> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      "X-Goog-Api-Key": apiKey,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  // CrUX answers 404 when the origin or URL has too little Chrome traffic.
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = googleErrorSchema.safeParse(json);
    throw new GoogleApiError(
      response.status,
      parsed.data?.error?.message ?? `Google API returned ${response.status}`,
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// CrUX
// ---------------------------------------------------------------------------

const cruxDateSchema = z.object({
  year: z.number(),
  month: z.number(),
  day: z.number(),
});
const cruxPeriodSchema = z.object({
  firstDate: cruxDateSchema,
  lastDate: cruxDateSchema,
});
// CLS percentiles arrive as strings ("0.05"); the time metrics as numbers.
const percentileSchema = z.union([z.number(), z.string()]).nullable();
const histogramBinSchema = z.object({
  start: z.union([z.number(), z.string()]),
  end: z.union([z.number(), z.string()]).optional(),
  density: z.number().optional(),
});

const cruxRecordSchema = z.object({
  record: z.object({
    metrics: z.record(
      z.string(),
      z.object({
        histogram: z.array(histogramBinSchema).optional(),
        percentiles: z.object({ p75: percentileSchema }).optional(),
      }),
    ),
    collectionPeriod: cruxPeriodSchema.optional(),
  }),
});

const cruxHistorySchema = z.object({
  record: z.object({
    metrics: z.record(
      z.string(),
      z.object({
        histogramTimeseries: z
          .array(
            z.object({
              densities: z.array(z.union([z.number(), z.string()]).nullable()),
            }),
          )
          .optional(),
        percentilesTimeseries: z
          .object({ p75s: z.array(percentileSchema) })
          .optional(),
      }),
    ),
    collectionPeriods: z.array(cruxPeriodSchema),
  }),
});

export type CruxRecord = z.infer<typeof cruxRecordSchema>["record"];
type CruxHistoryRecord = z.infer<typeof cruxHistorySchema>["record"];

function cruxBody(target: CruxTarget, formFactor: CruxFormFactor) {
  return {
    ...target,
    ...(formFactor === "ALL" ? {} : { formFactor }),
  };
}

function parseOrThrow<T>(schema: z.ZodType<T>, json: unknown, api: string): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new GoogleApiError(502, `${api} returned an unexpected response`);
  }
  return parsed.data;
}

// CrUX refreshes daily (History weekly), so a half-day cache keeps the
// dashboard and repeated agent calls off Google's per-minute quota. A miss
// (`json: null`) is cached too: an origin without enough traffic stays that
// way for the day.
const CRUX_CACHE_TTL_SECONDS = 12 * 60 * 60;
const cachedEntrySchema = z.object({ json: z.unknown() });

async function cachedCruxQuery<T>(
  endpoint: "queryRecord" | "queryHistoryRecord",
  schema: z.ZodType<{ record: T }>,
  apiKey: string,
  target: CruxTarget,
  formFactor: CruxFormFactor,
): Promise<T | null> {
  const api = endpoint === "queryRecord" ? "CrUX" : "CrUX History";
  const cacheKey = await buildCacheKey(`crux:${endpoint}`, {
    ...target,
    formFactor,
  });
  const cached = cachedEntrySchema.safeParse(await getCached(cacheKey));
  const json = cached.success
    ? cached.data.json
    : await googleFetch(`${CRUX_BASE}:${endpoint}`, apiKey, {
        method: "POST",
        body: cruxBody(target, formFactor),
        timeoutMs: CRUX_TIMEOUT_MS,
      });
  const record =
    json === null || json === undefined
      ? null
      : parseOrThrow(schema, json, api).record;
  if (!cached.success) {
    await setCached(cacheKey, { json: json ?? null }, CRUX_CACHE_TTL_SECONDS);
  }
  return record;
}

/** The latest 28-day CrUX record, or null when Google has too little data. */
export function queryCruxRecord(
  apiKey: string,
  target: CruxTarget,
  formFactor: CruxFormFactor,
): Promise<CruxRecord | null> {
  return cachedCruxQuery(
    "queryRecord",
    cruxRecordSchema,
    apiKey,
    target,
    formFactor,
  );
}

/** Weekly 28-day windows (25 by default, oldest first), or null without data. */
export function queryCruxHistory(
  apiKey: string,
  target: CruxTarget,
  formFactor: CruxFormFactor,
): Promise<CruxHistoryRecord | null> {
  return cachedCruxQuery(
    "queryHistoryRecord",
    cruxHistorySchema,
    apiKey,
    target,
    formFactor,
  );
}

// ---------------------------------------------------------------------------
// PageSpeed Insights
// ---------------------------------------------------------------------------

const loadingExperienceSchema = z
  .object({
    id: z.string().optional(),
    origin_fallback: z.boolean().optional(),
    metrics: z
      .record(
        z.string(),
        z.object({
          percentile: z.number().optional(),
          distributions: z
            .array(z.object({ proportion: z.number().optional() }))
            .optional(),
        }),
      )
      .optional(),
  })
  .optional();

const pagespeedSchema = z.object({
  loadingExperience: loadingExperienceSchema,
  originLoadingExperience: loadingExperienceSchema,
  lighthouseResult: z.object({
    requestedUrl: z.string().optional(),
    finalUrl: z.string().optional(),
    lighthouseVersion: z.string().optional(),
    fetchTime: z.string().optional(),
    // Only the key maps are checked: the audit bodies are large and are
    // reduced by the shared Lighthouse helpers, as for DataForSEO's reports.
    categories: z
      .record(z.string(), z.custom<RawLighthouseCategory>())
      .optional(),
    audits: z.record(z.string(), z.custom<RawLighthouseAudit>()).optional(),
  }),
});

type PagespeedResult = z.infer<typeof pagespeedSchema>;
export type PagespeedLoadingExperience = z.infer<
  typeof loadingExperienceSchema
>;

export async function runPagespeed(
  apiKey: string,
  input: { url: string; strategy: "mobile" | "desktop" },
): Promise<PagespeedResult> {
  const params = new URLSearchParams({
    url: input.url,
    strategy: input.strategy,
  });
  for (const category of [
    "performance",
    "accessibility",
    "best-practices",
    "seo",
  ]) {
    params.append("category", category);
  }
  const json = await googleFetch(`${PAGESPEED_URL}?${params}`, apiKey, {
    method: "GET",
    timeoutMs: PAGESPEED_TIMEOUT_MS,
  });
  if (json === null) {
    throw new GoogleApiError(
      404,
      `PageSpeed Insights could not load ${input.url}`,
    );
  }
  return parseOrThrow(pagespeedSchema, json, "PageSpeed Insights");
}
