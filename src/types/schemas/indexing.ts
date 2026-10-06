import { z } from "zod";
import {
  INDEXING_PROBLEM_KINDS,
  INDEXING_URL_STATUSES,
  URL_SUBMISSION_CHANNELS,
  URL_SUBMISSION_SOURCES,
  URL_SUBMISSION_STATUSES,
} from "@/shared/indexing";

export const INDEXING_CHANNEL_CHOICES = [
  "auto",
  ...URL_SUBMISSION_CHANNELS,
] as const;
export const MAX_SUBMIT_URLS = 10_000;
const MAX_DEDUPE_HOURS = 168;

const projectScoped = z.object({ projectId: z.string().min(1) });

export const indexingProjectSchema = projectScoped;

export const importIndexNowKeySchema = projectScoped.extend({
  key: z.string().trim().min(1).max(128),
  keyLocation: z.string().trim().max(2048).optional(),
});

export const updateIndexingSettingsSchema = projectScoped.extend({
  autoSubmitEnabled: z.boolean(),
  dedupeHours: z.number().int().min(1).max(MAX_DEDUPE_HOURS),
});

export const submitUrlsSchema = projectScoped.extend({
  urls: z.array(z.string().max(2048)).min(1).max(MAX_SUBMIT_URLS),
  channel: z.enum(INDEXING_CHANNEL_CHOICES).default("auto"),
  force: z.boolean().default(false),
});

export const indexingLogSchema = projectScoped.extend({
  url: z.string().trim().max(2048).optional(),
  status: z.enum(URL_SUBMISSION_STATUSES).optional(),
  source: z.enum(URL_SUBMISSION_SOURCES).optional(),
  channel: z.enum(URL_SUBMISSION_CHANNELS).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});

export const indexingStatusFiltersSchema = z.object({
  template: z.string().trim().max(500).optional(),
  pathPrefix: z.string().trim().max(500).optional(),
  status: z.enum(INDEXING_URL_STATUSES).optional(),
  coverageState: z.string().trim().max(200).optional(),
  problem: z.enum(INDEXING_PROBLEM_KINDS).optional(),
  notIndexedDays: z.number().int().min(1).max(365).default(7),
  limit: z.number().int().min(1).max(500).default(50),
});
export type IndexingStatusFilters = z.infer<typeof indexingStatusFiltersSchema>;

export const indexingStatusSchema = projectScoped.extend(
  indexingStatusFiltersSchema.shape,
);

export const reinspectUrlsSchema = projectScoped.extend({
  urls: z.array(z.string().url().max(2048)).min(1).max(10),
});
