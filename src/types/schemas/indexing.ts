import { z } from "zod";
import {
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
