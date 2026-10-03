// Umami traffic-source reads for agents: search engines, AI assistants and
// UTM campaigns.
import { z } from "zod";
import { UmamiInsightsService } from "@/server/features/umami/services/UmamiInsightsService";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { formatMcpTable } from "@/server/mcp/table";
import {
  answer,
  outputSchema,
  percentCell,
  rangeLine,
  rangeShape,
  READ_ONLY,
  UMAMI_NOTES,
} from "./umami-tool-support";

const searchEnginesShape = rangeShape;

export const getUmamiOrganicBySearchEngineTool = {
  name: "get_umami_organic_by_search_engine",
  config: {
    title: "Get Umami organic visits by search engine",
    description: `Split organic search visits by search engine (Google, Bing, Yahoo, DuckDuckGo, Ecosia, Yandex, others), from the referrer hosts Umami recorded, with visitors, bounce rate, average visit time, the previous period's visits and the hosts behind each engine. ${UMAMI_NOTES}`,
    inputSchema: searchEnginesShape,
    outputSchema,
    percentCell,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof searchEnginesShape>>, context) =>
      answer(
        args,
        context,
        () => UmamiInsightsService.getSearchEngines(args),
        (result) => {
          const summary = rangeLine("Organic visits by search engine", {
            ...result,
            organicDetection: null,
          });
          if (result.engines.length === 0) {
            return `${summary} No search engine referred a visit.`;
          }
          return `${summary}\n${formatMcpTable(result.engines, [
            { header: "engine", value: (row) => row.engine },
            { header: "visits", value: (row) => row.visits },
            { header: "previous", value: (row) => row.previousVisits },
            { header: "visitors", value: (row) => row.visitors },
            {
              header: "bounce",
              value: (row) => row.bounceRate,
              format: percentCell,
            },
            { header: "avg visit (s)", value: (row) => row.avgVisitSeconds },
            { header: "hosts", value: (row) => row.domains.join(" ") },
          ])}`;
        },
      ),
  ),
};

const aiShape = rangeShape;

export const getUmamiAiReferralsTool = {
  name: "get_umami_ai_referrals",
  config: {
    title: "Get Umami AI assistant referrals",
    description: `Measure traffic from AI assistants (ChatGPT, Perplexity, Copilot, Gemini, Claude, DeepSeek, Grok...) for GEO work: visits by referrer host, pageviews by utm_source (ChatGPT appends utm_source=chatgpt.com to links it cites), a daily trend and the landing pages. The two counts can overlap. Covers every source. ${UMAMI_NOTES}`,
    inputSchema: aiShape,
    outputSchema,
    percentCell,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof aiShape>>, context) =>
      answer(
        args,
        context,
        () => UmamiInsightsService.getAiReferrals(args),
        (result) => {
          const summary = rangeLine("AI assistant traffic", {
            ...result,
            organicDetection: null,
          });
          if (result.assistants.length === 0) {
            return `${summary} No visits from AI assistants recorded.`;
          }
          return `${summary}\n${formatMcpTable(result.assistants, [
            { header: "assistant", value: (row) => row.assistant },
            { header: "referred visits", value: (row) => row.referredVisits },
            { header: "tagged views", value: (row) => row.taggedViews },
            {
              header: "seen as",
              value: (row) => [...row.hosts, ...row.utmSources].join(" "),
            },
          ])}\nTop landing pages:\n${formatMcpTable(result.landingPages, [
            { header: "page", value: (row) => row.path },
            { header: "referred", value: (row) => row.referred },
            { header: "tagged", value: (row) => row.tagged },
          ])}`;
        },
      ),
  ),
};

const UTM_FIELD = z.enum([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]);

const campaignsShape = {
  ...rangeShape,
  field: UTM_FIELD.optional()
    .default("utm_campaign")
    .describe("With value: the UTM field to drill into."),
  value: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "A UTM value (e.g. a campaign name) to read its visits, landing pages and custom events. Omit for the campaign overview.",
    ),
};

export const getUmamiCampaignsTool = {
  name: "get_umami_campaigns",
  config: {
    title: "Get Umami UTM campaigns",
    description: `Read UTM campaigns: pageviews per utm_source, utm_medium, utm_campaign, utm_content and utm_term (Umami's UTM report) plus source / medium / campaign combinations parsed from landing URLs, in visits. With value, one UTM value's visits, bounce rate, landing pages and custom events. ${UMAMI_NOTES}`,
    inputSchema: campaignsShape,
    outputSchema,
    percentCell,
    annotations: READ_ONLY,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof campaignsShape>>, context) => {
      const { value } = args;
      if (value) {
        return answer(
          args,
          context,
          () => UmamiInsightsService.getCampaignDetail({ ...args, value }),
          (result) =>
            `${rangeLine(`${args.field}=${value}`, { ...result, organicDetection: null })} ${result.totals.visits} visit(s), bounce ${percentCell(result.totals.bounceRate)}.\nLanding pages:\n${formatMcpTable(
              result.landingPages,
              [
                { header: "page", value: (row) => row.name },
                { header: "visits", value: (row) => row.visits ?? row.count },
              ],
            )}\nEvents:\n${formatMcpTable(result.events, [
              { header: "event", value: (row) => row.event },
              { header: "count", value: (row) => row.count },
            ])}`,
        );
      }
      return answer(
        args,
        context,
        () => UmamiInsightsService.getCampaigns(args),
        (result) => {
          const fields = result.fields
            .filter((field) => field.rows.length > 0)
            .map(
              (field) =>
                `${field.field}: ${field.rows
                  .slice(0, 15)
                  .map((row) => `${row.value} (${row.views})`)
                  .join(", ")}`,
            );
          const report = result.utmReportAvailable
            ? fields.join("\n") || "No UTM-tagged pageviews."
            : "This Umami can't run its UTM report.";
          return `${rangeLine("UTM campaigns", { ...result, organicDetection: null })}\n${report}\nCombinations (visits):\n${formatMcpTable(
            result.combinations.slice(0, 30),
            [
              { header: "source", value: (row) => row.source },
              { header: "medium", value: (row) => row.medium },
              { header: "campaign", value: (row) => row.campaign },
              { header: "visits", value: (row) => row.count },
            ],
          )}`;
        },
      );
    },
  ),
};
