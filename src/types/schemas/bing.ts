import { z } from "zod";
import {
  optionalSearchPositiveIntParam,
  searchTextParam,
} from "@/types/schemas/domain";

export const bingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const BING_STATS_DIMENSIONS = ["query", "page"] as const;
export const BING_STATS_SORTS = [
  "clicks",
  "impressions",
  "ctr",
  "position",
] as const;
const BING_AI_CSV_KINDS = ["daily", "pages", "queries"] as const;

const projectScoped = { projectId: z.string().min(1) };

// Both dates or neither (the read then defaults to the newest stored data).
const dateRangeShape = {
  startDate: bingDateSchema.optional(),
  endDate: bingDateSchema.optional(),
};

function withValidRange<
  S extends z.ZodType<{ startDate?: string; endDate?: string }>,
>(schema: S): S {
  return schema.refine(
    (value) =>
      Boolean(value.startDate) === Boolean(value.endDate) &&
      (!value.startDate || !value.endDate || value.startDate <= value.endDate),
    { message: "Give both startDate and endDate (start first), or neither." },
  );
}

export const bingProjectSchema = z.object(projectScoped);

export const saveBingApiKeySchema = z.object({
  apiKey: z.string().trim().min(8).max(200),
});

export const setBingSiteSchema = z.object({
  ...projectScoped,
  siteUrl: z.string().min(1).max(2048),
});

export const setBingSyncEnabledSchema = z.object({
  ...projectScoped,
  enabled: z.boolean(),
});

export const bingRangeSchema = withValidRange(
  z.object({
    ...projectScoped,
    ...dateRangeShape,
    // Without dates: how many days, ending at the newest stored day of this
    // dataset (each one lags Bing by its own amount).
    days: z.number().int().min(1).max(366).optional(),
  }),
);

export const bingTableSchema = withValidRange(
  z.object({
    ...projectScoped,
    ...dateRangeShape,
    dimension: z.enum(BING_STATS_DIMENSIONS),
    search: z.string().trim().min(1).max(200).optional(),
    minImpressions: z.number().int().min(0).optional(),
    minPosition: z.number().min(1).optional(),
    maxPosition: z.number().min(1).optional(),
    sort: z.enum(BING_STATS_SORTS).default("clicks"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }),
);

export const bingDrilldownSchema = withValidRange(
  z
    .object({
      ...projectScoped,
      ...dateRangeShape,
      page: z.string().url().max(2048).optional(),
      query: z.string().trim().min(1).max(500).optional(),
    })
    .refine((value) => Boolean(value.page) !== Boolean(value.query), {
      message: "Give exactly one of page or query.",
    }),
);

export const bingBacklinksSchema = z.object({
  ...projectScoped,
  url: z.string().url().max(2048).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

// ~5 MB of CSV text.
const MAX_AI_CSV_LENGTH = 5_000_000;

export const importBingAiCsvSchema = withValidRange(
  z.object({
    ...projectScoped,
    csv: z.string().min(1).max(MAX_AI_CSV_LENGTH),
    kind: z.enum(BING_AI_CSV_KINDS).optional(),
    startDate: bingDateSchema.optional(),
    endDate: bingDateSchema.optional(),
  }),
);

// ---------------------------------------------------------------------------
// /p/$projectId/bing query params
// ---------------------------------------------------------------------------

const BING_RANGES = [
  "last_7_days",
  "last_28_days",
  "last_90_days",
  "last_6_months",
  "last_12_months",
] as const;
export type BingRange = (typeof BING_RANGES)[number];

/** Range presets of the Bing Insights page, counted back from the newest
 *  stored day. Longer ranges reach into OpenSEO's own snapshot history. */
export const BING_RANGE_DAYS: Record<BingRange, number> = {
  last_7_days: 7,
  last_28_days: 28,
  last_90_days: 90,
  last_6_months: 182,
  last_12_months: 365,
};

export const BING_INSIGHTS_TABS = [
  "queries",
  "pages",
  "striking",
  "crawl",
  "backlinks",
  "ai",
] as const;

export const BING_PAGE_SIZES = [25, 50, 100] as const;
export const BING_DEFAULT_PAGE_SIZE = 25;

export const bingInsightsSearchSchema = z.object({
  tab: z.enum(BING_INSIGHTS_TABS).optional().catch(undefined),
  range: z.enum(BING_RANGES).optional().catch(undefined),
  q: searchTextParam,
  sort: z.enum(BING_STATS_SORTS).optional().catch(undefined),
  page: optionalSearchPositiveIntParam,
  size: z.coerce
    .number()
    .refine((value) => (BING_PAGE_SIZES as readonly number[]).includes(value))
    .optional()
    .catch(undefined),
});

export type BingInsightsSearch = z.infer<typeof bingInsightsSearchSchema>;
