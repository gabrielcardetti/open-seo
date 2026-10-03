// Umami conversion reads for agents: event properties, funnels, attribution
// and Web Vitals.
import { z } from "zod";
import { UmamiConversionService } from "@/server/features/umami/services/UmamiConversionService";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { formatMcpTable } from "@/server/mcp/table";
import {
  answer,
  channelSchema,
  outputSchema,
  percentCell,
  rangeLine,
  rangeShape,
  READ_ONLY,
  UMAMI_NOTES,
} from "./umami-tool-support";

/** "a (3), b (2)" for the top rows of a report list. */
function topNames(rows: Array<{ name: string; visits: number }>): string {
  return (
    rows
      .slice(0, 10)
      .map((row) => `${row.name} (${row.visits})`)
      .join(", ") || "—"
  );
}

const eventPropertiesShape = {
  ...rangeShape,
  event: z.string().trim().min(1).max(200).describe("Custom event name."),
  channel: channelSchema("all"),
};

export const getUmamiEventPropertiesTool = {
  name: "get_umami_event_properties",
  config: {
    title: "Get Umami event properties",
    description: `Read one custom event's daily count and the properties recorded with it (Umami event data): at most ten properties, each with its ten most frequent values and counts. Use get_umami_events first for event names. ${UMAMI_NOTES}`,
    inputSchema: eventPropertiesShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof eventPropertiesShape>>, context) =>
      answer(
        args,
        context,
        () => UmamiConversionService.getEventDetail(args),
        (result) => {
          const total = result.points.reduce((sum, p) => sum + p.count, 0);
          const lines = result.properties.map(
            (property) =>
              `${property.name}: ${property.values
                .map((row) => `${row.value} (${row.count})`)
                .join(
                  ", ",
                )}${property.moreValues > 0 ? `, +${property.moreValues} more` : ""}`,
          );
          return `${rangeLine(`Event ${args.event}`, result)} ${total} occurrence(s).\n${lines.join("\n") || "No properties recorded."}`;
        },
      ),
  ),
};

const stepSchema = z.object({
  type: z.enum(["path", "event"]),
  value: z.string().trim().min(1).max(500),
});

const funnelShape = {
  ...rangeShape,
  channel: channelSchema("all"),
  reportId: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "A saved Umami funnel's id. Omit both reportId and steps to list saved funnels.",
    ),
  steps: z
    .array(stepSchema)
    .min(2)
    .max(8)
    .optional()
    .describe(
      "Ad hoc steps in order: page paths (a * matches any text) or custom event names.",
    ),
  windowMinutes: z
    .number()
    .int()
    .min(1)
    .max(10_080)
    .optional()
    .default(60)
    .describe("Minutes a visitor has to reach the next step (ad hoc funnels)."),
};

export const getUmamiFunnelTool = {
  name: "get_umami_funnel",
  config: {
    title: "Get Umami funnel",
    description: `Run a conversion funnel in Umami for a date range: a saved funnel (reportId) or ad hoc steps of page paths and custom events, with visitors per step, drop-off and the share of step 1 remaining. Without reportId or steps, lists the funnels saved in Umami. ${UMAMI_NOTES}`,
    inputSchema: funnelShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof funnelShape>>, context) => {
      const { reportId, steps, ...rest } = args;
      if (!reportId && !steps) {
        return answer(
          args,
          context,
          () => UmamiConversionService.getSavedReports(args.projectId),
          (result) => {
            const funnels = result.reports.filter((report) => report.funnel);
            if (!result.available) {
              return "This Umami version can't list saved reports.";
            }
            if (funnels.length === 0) {
              return "No funnels are saved on this website in Umami. Pass steps for an ad hoc funnel.";
            }
            return formatMcpTable(funnels, [
              { header: "reportId", value: (row) => row.id },
              { header: "name", value: (row) => row.name },
              {
                header: "steps",
                value: (row) =>
                  row.funnel?.steps.map((step) => step.value).join(" → "),
              },
            ]);
          },
        );
      }
      return answer(
        args,
        context,
        () =>
          UmamiConversionService.runFunnel(
            reportId ? { ...rest, reportId } : { ...rest, steps: steps ?? [] },
          ),
        (result) => {
          if (!result.available) {
            return "Funnels aren't available on this Umami version.";
          }
          return `${rangeLine(result.savedName ? `Funnel ${result.savedName}` : "Funnel", result)} Window ${result.windowMinutes} min.\n${formatMcpTable(
            result.steps,
            [
              { header: "step", value: (row) => `${row.type}: ${row.value}` },
              { header: "visitors", value: (row) => row.visitors },
              { header: "dropped", value: (row) => row.dropped },
              {
                header: "of step 1",
                value: (row) => row.remainingRate,
                format: percentCell,
              },
            ],
          )}`;
        },
      );
    },
  ),
};

const attributionShape = {
  ...rangeShape,
  channel: channelSchema("all"),
  model: z
    .enum(["first_click", "last_click"])
    .optional()
    .default("first_click"),
  type: z
    .enum(["path", "event"])
    .describe("Whether the goal is a page or an event."),
  value: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("The goal page path or custom event name."),
};

export const getUmamiAttributionTool = {
  name: "get_umami_attribution",
  config: {
    title: "Get Umami attribution",
    description: `Find which referrers, paid ads and UTM sources, mediums and campaigns led visitors to a goal page or custom event, crediting the first or last touch (Umami's attribution report). ${UMAMI_NOTES}`,
    inputSchema: attributionShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof attributionShape>>, context) =>
      answer(
        args,
        context,
        () =>
          UmamiConversionService.runAttribution({
            ...args,
            step: { type: args.type, value: args.value },
          }),
        (result) => {
          if (!result.available) {
            return "Attribution isn't available on this Umami version.";
          }
          return `${rangeLine(`Attribution (${args.model}) for ${args.type} ${args.value}`, result)} ${result.total?.visitors ?? 0} visitor(s) reached it.\nReferrers: ${topNames(result.referrers)}\nPaid ads: ${topNames(result.paidAds)}\nutm_source: ${topNames(result.utmSources)}\nutm_medium: ${topNames(result.utmMediums)}\nutm_campaign: ${topNames(result.utmCampaigns)}`;
        },
      ),
  ),
};

const vitalsShape = { ...rangeShape, channel: channelSchema("all") };

export const getUmamiWebVitalsTool = {
  name: "get_umami_web_vitals",
  config: {
    title: "Get Umami Web Vitals",
    description: `Read real-user Web Vitals from Umami (LCP, INP, CLS, FCP, TTFB at p50, p75 and p95) with a good / needs improvement / poor rating of the p75, plus LCP by page, device and browser. Empty unless the site's Umami script has data-performance="true". ${UMAMI_NOTES}`,
    inputSchema: vitalsShape,
    outputSchema,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof vitalsShape>>, context) =>
      answer(
        args,
        context,
        () => UmamiConversionService.getWebVitals(args),
        (result) => {
          if (!result.available) {
            return "Web Vitals aren't available on this Umami version (Umami 3.2 or later).";
          }
          if (!result.hasData) {
            return `${rangeLine("Web Vitals", result)} No Web Vitals data: add data-performance="true" to the site's Umami script tag to collect them.`;
          }
          return `${rangeLine("Web Vitals", result)} ${result.sampleCount} measurement(s).\n${formatMcpTable(
            result.metrics,
            [
              { header: "metric", value: (row) => row.metric },
              { header: "p50", value: (row) => row.p50 },
              { header: "p75", value: (row) => row.p75 },
              { header: "p95", value: (row) => row.p95 },
              { header: "rating (p75)", value: (row) => row.rating },
            ],
          )}\nLCP by page (ms):\n${formatMcpTable(result.pages.slice(0, 20), [
            { header: "page", value: (row) => row.name },
            { header: "p75", value: (row) => row.p75 },
            { header: "samples", value: (row) => row.count },
            { header: "rating", value: (row) => row.rating },
          ])}`;
        },
      ),
  ),
};
