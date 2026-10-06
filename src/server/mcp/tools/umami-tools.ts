import { z } from "zod";
import { UmamiReportingService } from "@/server/features/umami/services/UmamiReportingService";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import {
  answer,
  breakdownText,
  channelSchema,
  compareSchema,
  outputSchema,
  pageShape,
  rangeLine,
  rangeShape,
  READ_ONLY,
  UMAMI_NOTES,
} from "./umami-tool-support";

const overviewShape = {
  ...rangeShape,
  channel: channelSchema("organic_search"),
};

export const getUmamiOverviewTool = {
  name: "get_umami_overview",
  config: {
    title: "Get Umami overview",
    description: `Answer whether traffic is improving from the project's Umami website: visitors, visits, pageviews, bounce rate, average visit time and views per visit, compared with the previous equal-length period, plus a daily visitors/pageviews trend. Organic search by default; channel=all for every source. When traffic drops or jumps, check get_google_search_updates for a Google update in the same weeks. ${UMAMI_NOTES}`,
    inputSchema: overviewShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof overviewShape>>, context) =>
      answer(
        args,
        context,
        () => UmamiReportingService.getOverview(args),
        (result) => {
          const rows = (
            [
              "visitors",
              "visits",
              "pageviews",
              "bounceRate",
              "avgVisitSeconds",
              "viewsPerVisit",
            ] as const
          ).map((metric) => ({
            metric,
            current: result.current[metric],
            previous: result.previous[metric],
          }));
          const label =
            args.channel === "all" ? "All traffic" : "Organic search traffic";
          return `${rangeLine(label, result)}\n${formatMcpTable(rows, [
            { header: "metric", value: (row) => row.metric },
            { header: "current", value: (row) => row.current },
            { header: "previous", value: (row) => row.previous },
          ])}`;
        },
      ),
  ),
};

const landingShape = pageShape;

export const getUmamiOrganicLandingPagesTool = {
  name: "get_umami_organic_landing_pages",
  config: {
    title: "Get Umami organic landing pages",
    description: `Read the pages visits from search engines entered on (Umami entry pages), with visitors, visits, views, bounce rate and average visit time. ${UMAMI_NOTES}`,
    inputSchema: landingShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof landingShape>>, context) =>
      answer(
        args,
        context,
        () =>
          UmamiReportingService.getBreakdown({
            ...args,
            type: "entry",
            channel: "organic_search",
            comparePreviousPeriod: false,
          }),
        (result) => breakdownText("Organic landing pages", result),
      ),
  ),
};

const pagePerformanceShape = {
  ...pageShape,
  channel: channelSchema("organic_search"),
};

export const getUmamiPagePerformanceTool = {
  name: "get_umami_page_performance",
  config: {
    title: "Get Umami page performance",
    description: `Read every viewed page (Umami paths) with visitors, visits, views, bounce rate and average visit time. Organic search by default; channel=all for every source. ${UMAMI_NOTES}`,
    inputSchema: pagePerformanceShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof pagePerformanceShape>>, context) =>
      answer(
        args,
        context,
        () =>
          UmamiReportingService.getBreakdown({
            ...args,
            type: "path",
            comparePreviousPeriod: false,
          }),
        (result) => breakdownText("Page performance", result),
      ),
  ),
};

const ACQUISITION_TYPES = {
  channel: "channel",
  referrer: "referrer",
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
} as const;

const acquisitionShape = {
  ...pageShape,
  breakdown: z
    .enum(["channel", "referrer", "utm_source", "utm_medium", "utm_campaign"])
    .optional()
    .default("channel")
    .describe(
      "channel is Umami's own grouping (organicSearch, direct, referral, organicSocial, paidAds, email, llm...).",
    ),
  comparePreviousPeriod: compareSchema,
};

export const getUmamiTrafficAcquisitionTool = {
  name: "get_umami_traffic_acquisition",
  config: {
    title: "Get Umami traffic acquisition",
    description: `Compare where visits come from: Umami channels, referrer domains, or UTM source, medium and campaign, with visitors, visits, views, bounce rate and average visit time, optionally against the previous period. Covers every source. ${UMAMI_NOTES}`,
    inputSchema: acquisitionShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof acquisitionShape>>, context) =>
      answer(
        args,
        context,
        () =>
          UmamiReportingService.getBreakdown({
            ...args,
            type: ACQUISITION_TYPES[args.breakdown],
            channel: "all",
          }),
        (result) => breakdownText(`Traffic by ${args.breakdown}`, result),
      ),
  ),
};

const eventsShape = {
  ...pageShape,
  channel: channelSchema("all"),
  comparePreviousPeriod: compareSchema,
};

export const getUmamiEventsTool = {
  name: "get_umami_events",
  config: {
    title: "Get Umami events",
    description: `Read custom event counts by event name (sign-ups, clicks, purchases — whatever the site tracks with Umami), optionally against the previous period. All sources by default; channel=organic_search keeps events whose page was reached from a search engine. ${UMAMI_NOTES}`,
    inputSchema: eventsShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof eventsShape>>, context) =>
      answer(
        args,
        context,
        () => UmamiReportingService.getEvents(args),
        (result) => {
          const summary = `${rangeLine("Custom events", result)} ${result.rows.length} event(s).`;
          if (result.rows.length === 0) return summary;
          return `${summary}\n${formatMcpTable(result.rows, [
            { header: "event", value: (row) => row.event },
            { header: "count", value: (row) => row.count },
            ...(args.comparePreviousPeriod
              ? [
                  {
                    header: "previous",
                    value: (row: (typeof result.rows)[number]) =>
                      row.previousCount,
                  },
                ]
              : []),
          ])}`;
        },
      ),
  ),
};

const audienceShape = {
  ...pageShape,
  breakdown: z
    .enum(["country", "device", "browser", "os"])
    .optional()
    .default("device"),
  channel: channelSchema("organic_search"),
  comparePreviousPeriod: compareSchema,
};

export const getUmamiAudienceBreakdownTool = {
  name: "get_umami_audience_breakdown",
  config: {
    title: "Get Umami audience breakdown",
    description: `Read visitors, visits, views, bounce rate and average visit time by country, device, browser or operating system, optionally against the previous period. Organic search by default. Umami collects no demographics or user-level data. ${UMAMI_NOTES}`,
    inputSchema: audienceShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof audienceShape>>, context) =>
      answer(
        args,
        context,
        () =>
          UmamiReportingService.getBreakdown({ ...args, type: args.breakdown }),
        (result) => breakdownText(`Audience by ${args.breakdown}`, result),
      ),
  ),
};

const realtimeShape = { projectId: projectIdSchema };

export const getUmamiRealtimeTool = {
  name: "get_umami_realtime",
  config: {
    title: "Get Umami realtime visitors",
    description:
      "Count the visitors on the project's Umami website right now (seen in the last 5 minutes). Read-only and uses no OpenSEO credits.",
    inputSchema: realtimeShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof realtimeShape>>, context) =>
      answer(
        args,
        context,
        () => UmamiReportingService.getRealtime(args.projectId),
        (result) =>
          `${result.activeVisitors} active visitor(s) on ${result.source.websiteName ?? "the website"} in the last 5 minutes.`,
      ),
  ),
};
