import { z } from "zod";
import {
  optionalSearchPositiveIntParam,
  searchTextParam,
} from "@/types/schemas/domain";

const projectScoped = { projectId: z.string().min(1) };

export const umamiProjectSchema = z.object(projectScoped);

export const saveUmamiConnectionSchema = z.discriminatedUnion("mode", [
  z.object({
    ...projectScoped,
    mode: z.literal("cloud"),
    apiKey: z.string().trim().min(8).max(200),
  }),
  z.object({
    ...projectScoped,
    mode: z.literal("self_hosted"),
    baseUrl: z.string().trim().min(1).max(2048),
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
  }),
]);

export const selectUmamiWebsiteSchema = z.object({
  ...projectScoped,
  websiteId: z.string().min(1).max(100),
});

// ---------------------------------------------------------------------------
// Analytics page reads
// ---------------------------------------------------------------------------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_RANGE_DAYS = 731;

const UMAMI_CHANNELS = ["all", "organic_search"] as const;

const rangeShape = {
  ...projectScoped,
  startDate: dateSchema,
  endDate: dateSchema,
  channel: z.enum(UMAMI_CHANNELS).default("all"),
};

function withValidRange<
  S extends z.ZodType<{ startDate: string; endDate: string }>,
>(schema: S): S {
  return schema.refine(
    (value) =>
      value.startDate <= value.endDate &&
      Date.parse(value.endDate) - Date.parse(value.startDate) <=
        MAX_RANGE_DAYS * 86_400_000,
    {
      message: "Give a start date on or before the end date, within two years.",
    },
  );
}

export const umamiRangeSchema = withValidRange(z.object(rangeShape));

/** Umami metric types the page reads as tables. */
export const UMAMI_BREAKDOWN_TYPES = [
  "path",
  "entry",
  "exit",
  "title",
  "channel",
  "referrer",
  "country",
  "region",
  "city",
  "device",
  "browser",
  "os",
  "language",
  "screen",
] as const;
export type UmamiBreakdownType = (typeof UMAMI_BREAKDOWN_TYPES)[number];

export const umamiBreakdownSchema = withValidRange(
  z.object({
    ...rangeShape,
    type: z.enum(UMAMI_BREAKDOWN_TYPES),
    search: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(500).default(25),
    offset: z.number().int().min(0).max(10_000).default(0),
  }),
);

export const umamiEventSchema = withValidRange(
  z.object({
    ...rangeShape,
    event: z.string().trim().min(1).max(200),
  }),
);

const UTM_FILTER_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export const umamiCampaignDetailSchema = withValidRange(
  z.object({
    ...rangeShape,
    field: z.enum(UTM_FILTER_FIELDS),
    value: z.string().trim().min(1).max(200),
  }),
);

const funnelStepSchema = z.object({
  type: z.enum(["path", "event"]),
  value: z.string().trim().min(1).max(500),
});

export const umamiFunnelSchema = withValidRange(
  z
    .object({
      ...rangeShape,
      reportId: z.string().min(1).max(100).optional(),
      steps: z.array(funnelStepSchema).min(2).max(8).optional(),
      // Minutes a visitor has to go from one step to the next.
      windowMinutes: z.number().int().min(1).max(10_080).default(60),
    })
    .refine((value) => Boolean(value.reportId) !== Boolean(value.steps), {
      message: "Give a saved funnel or the steps, not both.",
    }),
);

export const umamiJourneySchema = withValidRange(
  z.object({
    ...rangeShape,
    steps: z.number().int().min(3).max(7).default(5),
    startStep: z.string().trim().min(1).max(500).optional(),
    endStep: z.string().trim().min(1).max(500).optional(),
  }),
);

export const umamiAttributionSchema = withValidRange(
  z.object({
    ...rangeShape,
    model: z.enum(["first_click", "last_click"]).default("first_click"),
    step: funnelStepSchema,
  }),
);

// ---------------------------------------------------------------------------
// /p/$projectId/analytics query params
// ---------------------------------------------------------------------------

export const UMAMI_ANALYTICS_TABS = [
  "overview",
  "seo",
  "pages",
  "acquisition",
  "events",
  "audience",
  "vitals",
] as const;

export const UMAMI_RANGES = [
  "last_7_days",
  "last_28_days",
  "last_90_days",
  "last_6_months",
  "last_12_months",
  "custom",
] as const;
export type UmamiRangePreset = (typeof UMAMI_RANGES)[number];

export const UMAMI_RANGE_DAYS: Record<
  Exclude<UmamiRangePreset, "custom">,
  number
> = {
  last_7_days: 7,
  last_28_days: 28,
  last_90_days: 90,
  last_6_months: 182,
  last_12_months: 365,
};

export const UMAMI_PAGE_SIZES = [25, 50, 100] as const;
export const UMAMI_DEFAULT_PAGE_SIZE = 25;

export const umamiAnalyticsSearchSchema = z.object({
  tab: z.enum(UMAMI_ANALYTICS_TABS).optional().catch(undefined),
  range: z.enum(UMAMI_RANGES).optional().catch(undefined),
  from: dateSchema.optional().catch(undefined),
  to: dateSchema.optional().catch(undefined),
  channel: z.enum(UMAMI_CHANNELS).optional().catch(undefined),
  // The sub-view of a tab (a page type, an audience dimension...).
  view: z.string().max(40).optional().catch(undefined),
  q: searchTextParam,
  page: optionalSearchPositiveIntParam,
  size: z.coerce
    .number()
    .refine((value) => (UMAMI_PAGE_SIZES as readonly number[]).includes(value))
    .optional()
    .catch(undefined),
});

export type UmamiAnalyticsSearch = z.infer<typeof umamiAnalyticsSearchSchema>;
