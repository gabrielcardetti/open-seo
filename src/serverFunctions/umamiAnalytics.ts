import { createServerFn } from "@tanstack/react-start";
import { UmamiConversionService } from "@/server/features/umami/services/UmamiConversionService";
import { UmamiInsightsService } from "@/server/features/umami/services/UmamiInsightsService";
import { UmamiOrganicLandingService } from "@/server/features/umami/services/UmamiOrganicLandingService";
import { UmamiReportingService } from "@/server/features/umami/services/UmamiReportingService";
import {
  classifyUmamiFailure,
  umamiAppError,
} from "@/server/features/umami/umamiFailures";
import { UmamiApiError } from "@/server/lib/umami/umamiErrors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  umamiAttributionSchema,
  umamiBreakdownSchema,
  umamiCampaignDetailSchema,
  umamiEventSchema,
  umamiFunnelSchema,
  umamiJourneySchema,
  umamiProjectSchema,
  umamiRangeSchema,
} from "@/types/schemas/umami";

// The Analytics page's reads. All are read-only and live: no connection,
// credentials Umami refuses, or a deleted website are states the page renders
// (`connected: false` with the reason); throttling and Umami faults are errors.

async function liveRead<T extends Record<string, unknown>>(
  read: () => Promise<T>,
) {
  try {
    return { connected: true as const, ...(await read()) };
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
}

export const getUmamiAnalyticsOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiRangeSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiReportingService.getOverview({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getUmamiActiveVisitors = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiProjectSchema)
  .handler(({ context }) =>
    liveRead(() => UmamiReportingService.getRealtime(context.projectId)),
  );

export const getUmamiBreakdownTable = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiBreakdownSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiReportingService.getBreakdown({
        ...data,
        projectId: context.projectId,
        comparePreviousPeriod: false,
      }),
    ),
  );

export const getUmamiSearchEngines = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiRangeSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiInsightsService.getSearchEngines({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getUmamiAiReferrals = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiRangeSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiInsightsService.getAiReferrals({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getUmamiOrganicLandings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiRangeSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiOrganicLandingService.getOrganicLandings({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getUmamiCampaigns = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiRangeSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiInsightsService.getCampaigns({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getUmamiCampaignDetail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiCampaignDetailSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiInsightsService.getCampaignDetail({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

/** Event counts against the previous period, and the top events' trend. */
export const getUmamiEventList = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiRangeSchema)
  .handler(({ data, context }) =>
    liveRead(async () => {
      const input = { ...data, projectId: context.projectId };
      const [events, trend] = await Promise.all([
        UmamiReportingService.getEvents({
          ...input,
          limit: 200,
          offset: 0,
          comparePreviousPeriod: true,
        }),
        UmamiConversionService.getEventTrend(input),
      ]);
      return { ...events, points: trend.points };
    }),
  );

export const getUmamiEventDetail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiEventSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiConversionService.getEventDetail({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getUmamiSavedReports = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiProjectSchema)
  .handler(({ context }) =>
    liveRead(() => UmamiConversionService.getSavedReports(context.projectId)),
  );

export const runUmamiFunnel = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiFunnelSchema)
  .handler(({ data, context }) => {
    const { reportId, steps, ...rest } = data;
    const input = { ...rest, projectId: context.projectId };
    return liveRead(() =>
      UmamiConversionService.runFunnel(
        reportId ? { ...input, reportId } : { ...input, steps: steps ?? [] },
      ),
    );
  });

export const runUmamiJourney = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiJourneySchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiConversionService.runJourney({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const runUmamiAttribution = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiAttributionSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiConversionService.runAttribution({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );

export const getUmamiWebVitals = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(umamiRangeSchema)
  .handler(({ data, context }) =>
    liveRead(() =>
      UmamiConversionService.getWebVitals({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );
