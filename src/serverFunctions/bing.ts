import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  bingAppError,
  classifyBingFailure,
} from "@/server/features/bing/bingFailures";
import { BingAiCitationService } from "@/server/features/bing/services/BingAiCitationService";
import { BingPerformanceService } from "@/server/features/bing/services/BingPerformanceService";
import { BingService } from "@/server/features/bing/services/BingService";
import { BingSiteHealthService } from "@/server/features/bing/services/BingSiteHealthService";
import { BingSyncService } from "@/server/features/bing/services/BingSyncService";
import { SitemapRegistryService } from "@/server/features/sitemaps/SitemapRegistryService";
import { BingApiError } from "@/server/lib/bing/bingErrors";
import { captureServerEvent } from "@/server/lib/posthog";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";
import {
  bingBacklinksSchema,
  bingDrilldownSchema,
  bingProjectSchema,
  bingRangeSchema,
  bingTableSchema,
  importBingAiCsvSchema,
  saveBingApiKeySchema,
  setBingSiteSchema,
  setBingSyncEnabledSchema,
} from "@/types/schemas/bing";

type EventContext = { userId: string; organizationId: string };

function track(
  context: EventContext,
  event: string,
  properties: Record<string, unknown> = {},
) {
  waitUntil(
    captureServerEvent({
      distinctId: context.userId,
      event,
      organizationId: context.organizationId,
      properties,
    }),
  );
}

/**
 * Live reads: no connection, a rejected key or a site the key can't read are
 * states the page renders (`connected: false` with the reason); throttling
 * and Bing faults are errors.
 */
function liveReadFailure(error: unknown) {
  const reason = classifyBingFailure(error);
  if (
    reason === "not_connected" ||
    reason === "key_invalid" ||
    reason === "site_access"
  ) {
    return { connected: false as const, reason };
  }
  if (error instanceof BingApiError) throw bingAppError(error);
  throw error;
}

// ---------------------------------------------------------------------------
// API key (per user; serves every project the user connects)
// ---------------------------------------------------------------------------

export const getBingKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) => BingService.getKeyStatus(context.userId));

export const saveBingApiKey = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(saveBingApiKeySchema)
  .handler(async ({ data, context }) => {
    const result = await BingService.saveApiKey(context.userId, data.apiKey);
    if (result.ok) track(context, "bing:key_save");
    return result;
  });

export const deleteBingApiKey = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    await BingService.deleteApiKey(context.userId);
    track(context, "bing:key_delete");
    return { hasKey: false as const };
  });

// ---------------------------------------------------------------------------
// Project connection
// ---------------------------------------------------------------------------

export const getBingConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingProjectSchema)
  .handler(async ({ context }) => ({
    ...(await BingService.getConnectionStatus({
      projectId: context.projectId,
      userId: context.userId,
    })),
    canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
  }));

export const listBingSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingProjectSchema)
  .handler(({ context }) =>
    BingService.listSites({
      userId: context.userId,
      projectId: context.projectId,
      projectDomain: context.project.domain,
    }),
  );

export const setBingSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setBingSiteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await BingService.setSite({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
      siteUrl: data.siteUrl,
    });
    track(context, "bing:site_select", {
      project_id: context.projectId,
      site_url: data.siteUrl,
    });
    // Suggest the site's sitemaps; the sync registers tracked ones with Bing.
    waitUntil(
      SitemapRegistryService.detect(context.projectId).catch((error) =>
        console.warn("Sitemap detection after connecting failed", error),
      ),
    );
    return { connected: true as const, siteUrl: data.siteUrl };
  });

export const disconnectBing = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await BingService.disconnect(context.projectId);
    track(context, "bing:disconnect", { project_id: context.projectId });
    return { connected: false as const };
  });

export const setBingSyncEnabled = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setBingSyncEnabledSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await BingService.setSyncEnabled(context.projectId, data.enabled);
    return { syncEnabled: data.enabled };
  });

export const syncBingNow = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await BingSyncService.syncNow(context.projectId);
    if (result.status === "synced") {
      track(context, "bing:sync_now", {
        project_id: context.projectId,
        errors: result.errors.length,
      });
    }
    return result;
  });

// ---------------------------------------------------------------------------
// Reads over the stored history (no Bing call)
// ---------------------------------------------------------------------------

export const getBingSummary = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingRangeSchema)
  .handler(({ data, context }) =>
    BingPerformanceService.summary(context.projectId, data),
  );

export const getBingTable = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingTableSchema)
  .handler(async ({ data, context }) => {
    const { page, pageSize, ...input } = data;
    const result = await BingPerformanceService.table(context.projectId, {
      ...input,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return result.connected ? { ...result, page, pageSize } : result;
  });

export const getBingCrawlHealth = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingRangeSchema)
  .handler(({ data, context }) =>
    BingSiteHealthService.crawlHealth(context.projectId, data),
  );

export const getBingAiCitations = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingRangeSchema)
  .handler(({ data, context }) =>
    BingAiCitationService.citations(context.projectId, data),
  );

// ---------------------------------------------------------------------------
// Live reads (call Bing)
// ---------------------------------------------------------------------------

export const getBingDrilldown = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingDrilldownSchema)
  .handler(async ({ data, context }) => {
    const range = { startDate: data.startDate, endDate: data.endDate };
    try {
      const result = await BingPerformanceService.drilldown(
        context.projectId,
        data.page
          ? { ...range, page: data.page }
          : { ...range, query: data.query ?? "" },
      );
      return { connected: true as const, ...result };
    } catch (error) {
      return liveReadFailure(error);
    }
  });

/** Without `url` reads the stored link-count snapshot; with `url` asks Bing
 *  for the pages linking to it. */
export const getBingBacklinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingBacklinksSchema)
  .handler(async ({ data, context }) => {
    try {
      return await BingSiteHealthService.backlinks(context.projectId, data);
    } catch (error) {
      return liveReadFailure(error);
    }
  });

// ---------------------------------------------------------------------------
// AI Performance CSV import
// ---------------------------------------------------------------------------

export const importBingAiCsv = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(importBingAiCsvSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await BingAiCitationService.importCsv(context.projectId, {
      csv: data.csv,
      kind: data.kind,
      periodStart: data.startDate,
      periodEnd: data.endDate,
    });
    if (result.ok) {
      track(context, "bing:ai_csv_import", {
        project_id: context.projectId,
        kind: result.kind,
        rows: result.imported,
      });
    }
    return result;
  });
