import { z } from "zod";
import { assertPaidAiSearchPlan } from "@/server/features/ai-search/services/access";
import { getBrandLookup } from "@/server/features/ai-search/services/brandLookup";
import { AppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import {
  languageCodeSchema,
  locationCodeSchema,
  projectIdSchema,
} from "@/server/mcp/schemas";
import { formatMcpTable, truncatedCell } from "@/server/mcp/table";
import { resolveMarket } from "@/shared/keyword-locations";
import {
  RESEARCH_SCOPE_PARAM_DESCRIPTION,
  researchScopeSchema,
} from "@/shared/researchScope";
import {
  BRAND_LOOKUP_MAX_INPUT_LENGTH,
  type BrandLookupResult,
} from "@/types/schemas/ai-search";

// The app renders every row; an agent needs the leaders, not the long tail.
const MCP_TOP_PAGES = 15;
const MCP_TOP_PAGE_PROMPTS = 3;
const MCP_TOP_QUERIES = 20;
const MCP_QUERY_SOURCES = 5;
const MCP_QUERY_BRANDS = 10;

// ---------------------------------------------------------------------------
// get_ai_brand_visibility
// ---------------------------------------------------------------------------

const brandVisibilityInputSchema = {
  projectId: projectIdSchema,
  target: z
    .string()
    .trim()
    .min(1)
    .max(BRAND_LOOKUP_MAX_INPUT_LENGTH)
    .optional()
    .describe(
      "Brand name (e.g. 'Acme') or domain/URL (e.g. 'acme.com'). Defaults to the project's domain.",
    ),
  competitors: z
    .array(z.string().trim().min(1).max(BRAND_LOOKUP_MAX_INPUT_LENGTH))
    .max(5)
    .optional()
    .describe(
      "Up to 5 competitor brands or domains to compare Share of Voice against. Adds ~260 credits.",
    ),
  scope: researchScopeSchema
    .optional()
    .describe(
      `${RESEARCH_SCOPE_PARAM_DESCRIPTION} Only applies to domain/URL targets. Under 'subfolder' and 'exact_url' only the cited pages are filtered; totals and Share of Voice stay domain-wide.`,
    ),
  locationCode: locationCodeSchema
    .optional()
    .describe(
      "Market for Google AI Overview data. Defaults to the project's market. ChatGPT data is always United States / English (the only market DataForSEO tracks for it).",
    ),
  languageCode: languageCodeSchema.optional(),
} as const;

type BrandVisibilityArgs = z.infer<
  z.ZodObject<typeof brandVisibilityInputSchema>
>;

function trimBrandLookup(result: BrandLookupResult) {
  return {
    ...result,
    topPages: result.topPages.slice(0, MCP_TOP_PAGES).map((page) => ({
      ...page,
      keywords: page.keywords.slice(0, MCP_TOP_PAGE_PROMPTS),
    })),
    topQueries: result.topQueries.slice(0, MCP_TOP_QUERIES).map((query) => ({
      ...query,
      citedSources: query.citedSources.slice(0, MCP_QUERY_SOURCES),
      brandsMentioned: query.brandsMentioned.slice(0, MCP_QUERY_BRANDS),
    })),
  };
}

function brandVisibilityText(result: ReturnType<typeof trimBrandLookup>) {
  if (!result.hasData) {
    return `No AI mentions found for ${result.resolvedTarget} on ChatGPT or Google AI Overview.`;
  }
  const lines = [
    `Target: ${result.resolvedTarget} (${result.detectedTargetType}${result.scope ? `, scope: ${result.scope}` : ""})`,
    `Total AI mentions: ${result.totalMentions ?? "?"} · AI search volume: ${result.totalAiSearchVolume ?? "?"}`,
    ...result.perPlatform.map(
      (p) =>
        `${p.platform}: ${p.status === "error" ? "failed" : `${p.mentions ?? "?"} mentions, ${p.aiSearchVolume ?? "?"} AI search volume`}`,
    ),
  ];
  if (result.aggregatesAreDomainLevel) {
    lines.push(
      "Note: totals and Share of Voice are domain-wide; only cited pages are filtered to the scope.",
    );
  }
  if (result.shareOfVoice) {
    lines.push(
      "",
      `Share of Voice (${result.shareOfVoice.platforms.join(" + ")}):`,
      formatMcpTable(result.shareOfVoice.entries, [
        { header: "brand", value: (e) => e.label },
        { header: "target", value: (e) => e.isTarget },
        { header: "mentions", value: (e) => e.mentions },
        { header: "share %", value: (e) => e.sharePct },
      ]),
    );
  }
  if (result.topPages.length > 0) {
    lines.push(
      "",
      "Pages AI answers cite:",
      formatMcpTable(result.topPages, [
        { header: "platform", value: (p) => p.platform },
        { header: "url", value: (p) => p.url },
        { header: "mentions", value: (p) => p.mentions },
        { header: "ai volume", value: (p) => p.capturedVolume },
        {
          header: "example prompts",
          value: (p) => p.keywords.map((k) => k.question).join(" / "),
          format: truncatedCell(160),
        },
      ]),
    );
  }
  if (result.topQueries.length > 0) {
    lines.push(
      "",
      "Prompts that mention the target:",
      formatMcpTable(result.topQueries, [
        { header: "platform", value: (q) => q.platform },
        {
          header: "prompt",
          value: (q) => q.question,
          format: truncatedCell(120),
        },
        { header: "ai volume", value: (q) => q.aiSearchVolume },
        {
          header: "cited domains",
          value: (q) => q.citedSources.map((s) => s.domain ?? s.url).join(", "),
          format: truncatedCell(120),
        },
      ]),
    );
  }
  return lines.join("\n");
}

export const getAiBrandVisibilityTool = {
  name: "get_ai_brand_visibility",
  config: {
    title: "Get AI brand visibility",
    description:
      "How often ChatGPT and Google AI Overview mention a brand or domain: total mentions and AI search volume per platform, the pages AI answers cite (with example prompts), the prompts that mention it with the sources cited and other brands named, monthly AI search volume, and — with competitors — Share of Voice. From DataForSEO's LLM Mentions database, refreshed monthly. Charges credits (~1,030 typical; ~1,290 with competitors). Cached for 24 hours. Hosted accounts require a paid plan.",
    inputSchema: brandVisibilityInputSchema,
    outputSchema: z
      .object({
        resolvedTarget: z.string(),
        hasData: z.boolean(),
        totalMentions: z.number().nullable(),
        totalAiSearchVolume: z.number().nullable(),
        perPlatform: z.array(looseObjectOutputSchema),
        shareOfVoice: looseObjectOutputSchema.nullable(),
        topPages: z.array(looseObjectOutputSchema),
        topQueries: z.array(looseObjectOutputSchema),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: BrandVisibilityArgs, context) => {
    const query = args.target ?? context.project.domain;
    if (!query) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Pass a target: this project has no domain to default to.",
      );
    }
    await assertPaidAiSearchPlan(context.auth.organizationId, "Brand Lookup");
    const { locationCode, languageCode } = resolveMarket(args, context.project);
    const result = trimBrandLookup(
      await getBrandLookup(
        {
          projectId: args.projectId,
          query,
          competitors: args.competitors ?? [],
          scope: args.scope,
          locationCode,
          languageCode,
        },
        context.billing,
      ),
    );
    return mcpResponse({
      text: brandVisibilityText(result),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/brand-lookup`,
        {
          q: query,
          c: args.competitors?.length ? args.competitors.join(",") : undefined,
        },
      ),
      structuredContent: result,
    });
  }),
};
