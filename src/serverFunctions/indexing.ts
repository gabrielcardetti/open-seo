import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { IndexingService } from "@/server/features/indexing/IndexingService";
import { SitemapWatchService } from "@/server/features/indexing/SitemapWatchService";
import { UrlSubmissionService } from "@/server/features/indexing/UrlSubmissionService";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  importIndexNowKeySchema,
  indexingLogSchema,
  indexingProjectSchema,
  submitUrlsSchema,
  updateIndexingSettingsSchema,
} from "@/types/schemas/indexing";

/** Sitemap candidate lists are capped here; the counts stay exact. */
const MAX_LISTED_CANDIDATES = 500;

export const getIndexingSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexingProjectSchema)
  .handler(async ({ context }) => {
    const setup = await IndexingService.getSetup(
      context.projectId,
      getPublicOrigin(getRequest()),
    );
    return {
      ...setup,
      canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
    };
  });

export const generateIndexNowKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexingProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return IndexingService.generateKey(context.projectId);
  });

export const importIndexNowKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(importIndexNowKeySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return IndexingService.importKey(context.projectId, data);
  });

export const verifyIndexNowKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexingProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return IndexingService.verifyKey(context.projectId);
  });

export const updateIndexingSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateIndexingSettingsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await IndexingService.updateSettings(context.projectId, data);
    return { ok: true };
  });

export const rotateDeployHookSecret = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexingProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return IndexingService.rotateDeployHookSecret(context.projectId);
  });

export const submitUrlsForIndexing = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(submitUrlsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return UrlSubmissionService.submitUrls(
      context.projectId,
      data.urls,
      "manual",
      {
        channel: data.channel,
        force: data.force,
      },
    );
  });

export const getIndexingLog = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexingLogSchema)
  .handler(async ({ data, context }) => {
    const { projectId: _projectId, ...input } = data;
    return IndexingService.getLog(context.projectId, input);
  });

/** Live sitemap diff, nothing recorded or sent. */
export const getIndexingCandidates = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexingProjectSchema)
  .handler(async ({ context }) => {
    const outcome = await SitemapWatchService.previewCandidates(
      context.projectId,
    );
    if (!outcome.ok) return outcome;
    const { diff } = outcome;
    return {
      ok: true as const,
      baseline: diff.baseline,
      origin: diff.origin,
      totalUrls: diff.totalUrls,
      truncated: diff.truncated,
      warning: outcome.warning,
      newCount: diff.newUrls.length,
      changedCount: diff.changedUrls.length,
      removedCount: diff.removedUrls.length,
      newUrls: diff.newUrls.slice(0, MAX_LISTED_CANDIDATES),
      changedUrls: diff.changedUrls.slice(0, MAX_LISTED_CANDIDATES),
      removedUrls: diff.removedUrls.slice(0, MAX_LISTED_CANDIDATES),
    };
  });

/** Record the sitemap inventory now and submit what is new or changed. */
export const runIndexingSitemapCheck = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(indexingProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const outcome = await SitemapWatchService.runSitemapCheck(
      context.projectId,
      "manual",
    );
    if (!outcome.ok) return outcome;
    return {
      ok: true as const,
      baseline: outcome.diff.baseline,
      totalUrls: outcome.diff.totalUrls,
      newCount: outcome.diff.newUrls.length,
      changedCount: outcome.diff.changedUrls.length,
      problem: outcome.submission?.problem ?? null,
      warning: outcome.warning,
      counts: outcome.submission?.counts ?? {},
    };
  });
