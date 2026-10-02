import { z } from "zod";
import { MAX_PROJECT_SITEMAPS, SITEMAP_ENGINES } from "@/shared/sitemaps";

const sitemapUrls = z
  .array(z.string().trim().min(1).max(2048))
  .max(MAX_PROJECT_SITEMAPS);

/** One batch of changes to a project's sitemap registry. */
export const sitemapChangesSchema = z.object({
  track: sitemapUrls.optional(),
  ignore: sitemapUrls.optional(),
  add: sitemapUrls.optional(),
  remove: sitemapUrls.optional(),
  detect: z.boolean().optional(),
});

export const sitemapSubmissionSchema = z.object({
  urls: sitemapUrls.min(1).optional(),
  engines: z.array(z.enum(SITEMAP_ENGINES)).min(1).default(["google", "bing"]),
  onlyMissing: z.boolean().default(true),
});

const projectScoped = z.object({ projectId: z.string().min(1) });

export const sitemapsProjectSchema = projectScoped;
export const updateSitemapsSchema = projectScoped.extend(
  sitemapChangesSchema.shape,
);
export const submitSitemapsSchema = projectScoped.extend(
  sitemapSubmissionSchema.shape,
);
