/**
 * Core Web Vitals as Google measures them: Chrome UX Report field data (the
 * 75th percentile of real Chrome users over 28 days, the numbers behind
 * Search's page experience signals), its weekly history, and PageSpeed
 * Insights runs. Needs GOOGLE_API_KEY; nothing is stored.
 */
import {
  queryCruxHistory,
  queryCruxRecord,
  runPagespeed as fetchPagespeed,
  type CruxFormFactor,
  type CruxRecord,
  type CruxTarget,
  type PagespeedLoadingExperience,
} from "@/server/lib/googleWebVitalsClient";
import {
  buildStoredLighthouseIssues,
  buildStoredLighthouseMetrics,
  scoreToPercent,
  summarizeLighthouseIssues,
} from "@/server/lib/lighthouseStoredPayload";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import {
  rateWebVital,
  WEB_VITALS,
  type WebVital,
  type WebVitalRating,
} from "@/shared/web-vitals";

export const CRUX_API_KEY_ENV = "GOOGLE_API_KEY";
export const CRUX_SETUP_DOCS_URL =
  "https://github.com/gabrielcardetti/open-seo/blob/main/docs/SELF_HOSTING_GOOGLE_CORE_WEB_VITALS.md";

// CrUX metric names; TTFB is still published under its experimental name.
const CRUX_METRIC_NAMES: Record<WebVital, readonly string[]> = {
  lcp: ["largest_contentful_paint"],
  inp: ["interaction_to_next_paint"],
  cls: ["cumulative_layout_shift"],
  fcp: ["first_contentful_paint"],
  ttfb: ["experimental_time_to_first_byte", "time_to_first_byte"],
};

// PageSpeed's loadingExperience keys. Its CLS percentile is CLS x 100.
const PAGESPEED_METRIC_NAMES: Record<WebVital, string> = {
  lcp: "LARGEST_CONTENTFUL_PAINT_MS",
  inp: "INTERACTION_TO_NEXT_PAINT",
  cls: "CUMULATIVE_LAYOUT_SHIFT_SCORE",
  fcp: "FIRST_CONTENTFUL_PAINT_MS",
  ttfb: "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
};

export type FieldMetric = {
  metric: WebVital;
  p75: number | null;
  rating: WebVitalRating | null;
  /** Share of page loads rated good / needs improvement / poor (0-1). */
  good: number | null;
  needsImprovement: number | null;
  poor: number | null;
};

type CoreWebVitalsAssessment = "passed" | "failed" | null;

type HistoryWeek = { endDate: string } & Record<WebVital, number | null>;

async function requireApiKey(): Promise<string> {
  const apiKey = await getOptionalEnvValue(CRUX_API_KEY_ENV);
  if (!apiKey) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      `${CRUX_API_KEY_ENV} is not set. See ${CRUX_SETUP_DOCS_URL}`,
    );
  }
  return apiKey;
}

async function isConfigured(): Promise<boolean> {
  return Boolean(await getOptionalEnvValue(CRUX_API_KEY_ENV));
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** Google's assessment: passed when LCP, INP and CLS are all good at p75.
 *  Without enough interactions for INP, it is judged on LCP and CLS. */
function assess(metrics: FieldMetric[]): CoreWebVitalsAssessment {
  const core = metrics.filter(
    (m) => ["lcp", "inp", "cls"].includes(m.metric) && m.rating !== null,
  );
  if (
    !core.some((m) => m.metric === "lcp") ||
    !core.some((m) => m.metric === "cls")
  ) {
    return null;
  }
  return core.every((m) => m.rating === "good") ? "passed" : "failed";
}

function cruxMetric(record: CruxRecord, metric: WebVital): FieldMetric {
  const name = CRUX_METRIC_NAMES[metric].find((key) => record.metrics[key]);
  const data = name ? record.metrics[name] : undefined;
  const p75 = toNumber(data?.percentiles?.p75);
  // CrUX bins match the good / needs improvement / poor thresholds.
  const densities = (data?.histogram ?? []).map((bin) => bin.density ?? null);
  return {
    metric,
    p75,
    rating: rateWebVital(metric, p75),
    good: densities[0] ?? null,
    needsImprovement: densities[1] ?? null,
    poor: densities[2] ?? null,
  };
}

function originOf(url: string): string {
  return new URL(url).origin;
}

/** Origins to try for a bare project domain: as given, then with or without
 *  www, since CrUX keys data by the exact origin. */
function domainOrigins(domain: string): string[] {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const alternate = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [`https://${host}`, `https://${alternate}`];
}

type FieldDataInput = {
  formFactor: CruxFormFactor;
  includeHistory: boolean;
} & ({ url: string } | { origin: string } | { projectDomain: string });

/**
 * The latest CrUX record for a URL or origin, with its weekly history on
 * request. A URL without enough traffic falls back to its origin, and a
 * project domain tries both the www and bare origins.
 */
async function getFieldData(input: FieldDataInput) {
  const apiKey = await requireApiKey();
  const candidates: Array<{ scope: "url" | "origin"; target: CruxTarget }> =
    "url" in input
      ? [
          { scope: "url", target: { url: input.url } },
          { scope: "origin", target: { origin: originOf(input.url) } },
        ]
      : "origin" in input
        ? [{ scope: "origin", target: { origin: originOf(input.origin) } }]
        : domainOrigins(input.projectDomain).map((origin) => ({
            scope: "origin" as const,
            target: { origin },
          }));

  for (const candidate of candidates) {
    const record = await queryCruxRecord(
      apiKey,
      candidate.target,
      input.formFactor,
    );
    if (!record) continue;
    const metrics = WEB_VITALS.map((metric) => cruxMetric(record, metric));
    const history = input.includeHistory
      ? await getHistory(apiKey, candidate.target, input.formFactor)
      : null;
    return {
      found: true as const,
      scope: candidate.scope,
      target:
        "url" in candidate.target
          ? candidate.target.url
          : candidate.target.origin,
      formFactor: input.formFactor,
      collectionPeriod: record.collectionPeriod
        ? {
            firstDate: isoDate(record.collectionPeriod.firstDate),
            lastDate: isoDate(record.collectionPeriod.lastDate),
          }
        : null,
      assessment: assess(metrics),
      metrics,
      history,
    };
  }

  return {
    found: false as const,
    formFactor: input.formFactor,
    tried: candidates.map((c) =>
      "url" in c.target ? c.target.url : c.target.origin,
    ),
  };
}

async function getHistory(
  apiKey: string,
  target: CruxTarget,
  formFactor: CruxFormFactor,
): Promise<HistoryWeek[] | null> {
  const record = await queryCruxHistory(apiKey, target, formFactor);
  if (!record) return null;
  const p75sOf = (metric: WebVital) => {
    const name = CRUX_METRIC_NAMES[metric].find((key) => record.metrics[key]);
    return name
      ? (record.metrics[name]?.percentilesTimeseries?.p75s ?? []).map(toNumber)
      : [];
  };
  const lcp = p75sOf("lcp");
  const inp = p75sOf("inp");
  const cls = p75sOf("cls");
  const fcp = p75sOf("fcp");
  const ttfb = p75sOf("ttfb");
  return record.collectionPeriods.map((period, index) => ({
    endDate: isoDate(period.lastDate),
    lcp: lcp[index] ?? null,
    inp: inp[index] ?? null,
    cls: cls[index] ?? null,
    fcp: fcp[index] ?? null,
    ttfb: ttfb[index] ?? null,
  }));
}

function pagespeedField(
  experience: PagespeedLoadingExperience,
  scope: "url" | "origin",
) {
  const raw = experience?.metrics;
  if (!raw || Object.keys(raw).length === 0) return null;
  const metrics = WEB_VITALS.map((metric): FieldMetric => {
    const data = raw[PAGESPEED_METRIC_NAMES[metric]];
    const percentile = data?.percentile ?? null;
    const p75 =
      percentile === null
        ? null
        : metric === "cls"
          ? percentile / 100
          : percentile;
    const proportions = (data?.distributions ?? []).map(
      (d) => d.proportion ?? null,
    );
    return {
      metric,
      p75,
      rating: rateWebVital(metric, p75),
      good: proportions[0] ?? null,
      needsImprovement: proportions[1] ?? null,
      poor: proportions[2] ?? null,
    };
  });
  return { scope, assessment: assess(metrics), metrics };
}

/** One PageSpeed Insights run: Lighthouse scores, lab metrics, the biggest
 *  opportunities, and the field data Google shows beside them. */
async function runPagespeed(input: {
  url: string;
  strategy: "mobile" | "desktop";
}) {
  const apiKey = await requireApiKey();
  const result = await fetchPagespeed(apiKey, input);
  const lighthouse = result.lighthouseResult;
  const categories = lighthouse.categories ?? {};
  const audits = lighthouse.audits ?? {};
  const { issues } = buildStoredLighthouseIssues({ audits, categories });
  // PageSpeed marks a URL without its own field data with origin_fallback.
  const urlHasOwnData = !result.loadingExperience?.origin_fallback;
  const field =
    (urlHasOwnData ? pagespeedField(result.loadingExperience, "url") : null) ??
    pagespeedField(result.originLoadingExperience, "origin");

  return {
    requestedUrl: lighthouse.requestedUrl ?? input.url,
    finalUrl: lighthouse.finalUrl ?? input.url,
    strategy: input.strategy,
    fetchedAt: lighthouse.fetchTime ?? new Date().toISOString(),
    lighthouseVersion: lighthouse.lighthouseVersion ?? null,
    scores: {
      performance: scoreToPercent(categories.performance?.score),
      accessibility: scoreToPercent(categories.accessibility?.score),
      bestPractices: scoreToPercent(categories["best-practices"]?.score),
      seo: scoreToPercent(categories.seo?.score),
    },
    lab: buildStoredLighthouseMetrics({ audits }),
    field,
    ...summarizeLighthouseIssues(issues),
  };
}

export const CoreWebVitalsService = {
  isConfigured,
  getFieldData,
  runPagespeed,
} as const;
