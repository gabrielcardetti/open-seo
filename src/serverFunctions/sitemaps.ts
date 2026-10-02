import { createServerFn } from "@tanstack/react-start";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { SitemapCoverageService } from "@/server/features/sitemaps/SitemapCoverageService";
import { SitemapRegistryService } from "@/server/features/sitemaps/SitemapRegistryService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  sitemapsProjectSchema,
  submitSitemapsSchema,
  updateSitemapsSchema,
} from "@/types/schemas/sitemaps";

/** The registry with each tracked sitemap's Google and Bing coverage. */
export const getSitemaps = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sitemapsProjectSchema)
  .handler(async ({ context }) => ({
    ...(await SitemapCoverageService.coverage(context.projectId)),
    canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
  }));

export const updateSitemaps = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateSitemapsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const { projectId: _projectId, ...changes } = data;
    return SitemapRegistryService.update(context.projectId, changes);
  });

export const submitSitemaps = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(submitSitemapsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return SitemapCoverageService.submitToEngines(context.projectId, data);
  });
