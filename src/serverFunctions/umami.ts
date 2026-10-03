import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { UmamiReportingService } from "@/server/features/umami/services/UmamiReportingService";
import { UmamiService } from "@/server/features/umami/services/UmamiService";
import {
  classifyUmamiFailure,
  umamiAppError,
} from "@/server/features/umami/umamiFailures";
import { captureServerEvent } from "@/server/lib/posthog";
import { UmamiApiError } from "@/server/lib/umami/umamiErrors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  saveUmamiConnectionSchema,
  selectUmamiWebsiteSchema,
  umamiProjectSchema,
} from "@/types/schemas/umami";

function track(
  context: { userId: string; organizationId: string; projectId: string },
  event: string,
) {
  waitUntil(
    captureServerEvent({
      distinctId: context.userId,
      event,
      organizationId: context.organizationId,
      properties: { project_id: context.projectId },
    }),
  );
}

export const getUmamiConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiProjectSchema)
  .handler(async ({ context }) => ({
    ...(await UmamiService.getConnectionStatus(context.projectId)),
    canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
  }));

/** Checks the credentials with Umami before saving them; a rejection is an
 *  answer the form shows, not an error. */
export const saveUmamiConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveUmamiConnectionSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await UmamiService.saveConnection({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
      credentials:
        data.mode === "cloud"
          ? { mode: "cloud", apiKey: data.apiKey }
          : {
              mode: "self_hosted",
              username: data.username,
              password: data.password,
            },
      baseUrl: data.mode === "self_hosted" ? data.baseUrl : undefined,
    });
    if (result.ok) track(context, "umami:credentials_save");
    return result;
  });

export const listUmamiWebsites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiProjectSchema)
  .handler(({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return UmamiService.listWebsites({
      projectId: context.projectId,
      projectDomain: context.project.domain,
    });
  });

export const selectUmamiWebsite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(selectUmamiWebsiteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const website = await UmamiService.selectWebsite({
      projectId: context.projectId,
      websiteId: data.websiteId,
    });
    track(context, "umami:website_select");
    return { connected: true as const, ...website };
  });

export const disconnectUmami = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await UmamiService.disconnect(context.projectId);
    track(context, "umami:disconnect");
    return { connected: false as const };
  });

/** The dashboard's Umami card: organic visitors vs the previous period and a
 *  daily trend over the last 28 days. A missing connection or credentials
 *  Umami refuses render as the connect state, not an error. */
export const getUmamiDashboardReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiProjectSchema)
  .handler(async ({ context }) => {
    try {
      const overview = await UmamiReportingService.getOverview({
        projectId: context.projectId,
        channel: "organic_search",
      });
      return {
        connected: true as const,
        websiteName: overview.source.websiteName,
        totals: overview.current,
        prevTotals: overview.previous,
        trend: overview.trend,
      };
    } catch (error) {
      const reason = classifyUmamiFailure(error);
      if (
        reason === "not_connected" ||
        reason === "auth" ||
        reason === "website_not_found"
      ) {
        return { connected: false as const, reason };
      }
      if (error instanceof UmamiApiError) throw umamiAppError(error);
      throw error;
    }
  });
