import { z } from "zod";
import { assertAiSearchAccess } from "@/server/features/ai-search/services/aiSearchAccess";
import { getBrandLookup } from "@/server/features/ai-search/services/brandLookup";
import { explorePrompt } from "@/server/features/ai-search/services/promptExplorer";
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
  PROMPT_EXPLORER_MAX_PROMPT_LENGTH,
  promptExplorerModelSchema,
  webSearchCountryCodeSchema,
  type BrandLookupResult,
  type PromptExplorerResult,
} from "@/types/schemas/ai-search";

// The app renders every row; an agent needs the leaders, not the long tail.
const MCP_TOP_PAGES = 15;
const MCP_TOP_PAGE_PROMPTS = 3;
const MCP_TOP_QUERIES = 20;
const MCP_QUERY_SOURCES = 5;
const MCP_QUERY_BRANDS = 10;
// One answer can run to ~16k characters at the 4096-token cap; four of them
// would dominate the context window.
const MCP_ANSWER_CHARS = 6000;
const MCP_ANSWER_CITATIONS = 15;
const MCP_FAN_OUT_QUERIES = 10;

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
    await assertAiSearchAccess(context.auth.organizationId);
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

// ---------------------------------------------------------------------------
// explore_ai_prompt
// ---------------------------------------------------------------------------

const exploreAiPromptInputSchema = {
  projectId: projectIdSchema,
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(PROMPT_EXPLORER_MAX_PROMPT_LENGTH)
    .describe(
      "The question to ask, as a user would type it into the assistant.",
    ),
  models: z
    .array(promptExplorerModelSchema)
    .min(1)
    .max(4)
    .describe(
      "Assistants to ask. Credits per model with web search: chat_gpt ~115, claude ~230, gemini ~140, perplexity ~50 (about half without web search).",
    ),
  highlightBrand: z
    .string()
    .trim()
    .min(1)
    .max(BRAND_LOOKUP_MAX_INPUT_LENGTH)
    .optional()
    .describe(
      "Brand or domain to look for: each answer reports brandMentioned and flags matching citations. Free to change — cached answers are re-checked.",
    ),
  webSearch: z
    .boolean()
    .optional()
    .describe(
      "Let the assistants search the web, as they do for most users (default true). Without it they answer from training data only.",
    ),
  webSearchCountryCode: z
    .string()
    .length(2)
    .optional()
    .describe(
      "ISO country code (e.g. 'ES', 'US') the web search should act from. ChatGPT and Perplexity accept any country, Claude a subset, Gemini none (it is skipped with an error, not charged). Omit for no country preference.",
    ),
} as const;

type ExploreAiPromptArgs = z.infer<
  z.ZodObject<typeof exploreAiPromptInputSchema>
>;

function trimPromptResult(result: PromptExplorerResult) {
  return {
    ...result,
    results: result.results.map((model) => {
      if (model.status === "error") return model;
      return {
        ...model,
        text:
          model.text.length > MCP_ANSWER_CHARS
            ? `${model.text.slice(0, MCP_ANSWER_CHARS)}…`
            : model.text,
        textTruncated: model.text.length > MCP_ANSWER_CHARS,
        citations: model.citations.slice(0, MCP_ANSWER_CITATIONS),
        fanOutQueries: model.fanOutQueries.slice(0, MCP_FAN_OUT_QUERIES),
      };
    }),
  };
}

function promptResultText(result: ReturnType<typeof trimPromptResult>) {
  const blocks = result.results.map((model) => {
    if (model.status === "error") {
      return `## ${model.model}: failed (${model.errorCode})\n${model.message}`;
    }
    const header = [
      `## ${model.model}${model.modelName ? ` (${model.modelName})` : ""}`,
      `Web search: ${model.webSearch ? "yes" : "no"}${result.highlightBrand ? ` · ${result.highlightBrand} mentioned: ${model.brandMentioned ? "yes" : "no"}` : ""}`,
    ];
    if (model.fanOutQueries.length > 0) {
      header.push(`Searched for: ${model.fanOutQueries.join(" / ")}`);
    }
    const citations =
      model.citations.length > 0
        ? formatMcpTable(model.citations, [
            { header: "domain", value: (c) => c.domain },
            { header: "url", value: (c) => c.url },
            { header: "brand match", value: (c) => c.matchedBrand },
          ])
        : "No citations.";
    return [...header, "", model.text, "", "Citations:", citations].join("\n");
  });
  return [`Prompt: ${result.prompt}`, ...blocks].join("\n\n");
}

export const exploreAiPromptTool = {
  name: "explore_ai_prompt",
  config: {
    title: "Explore an AI prompt",
    description:
      "Ask one prompt to ChatGPT, Claude, Gemini and/or Perplexity and read their answers side by side: the answer text, the sources each one cited, the searches it ran (fan-out queries), and whether a given brand was mentioned. Use it to see who AI assistants recommend for a query and which pages they cite. Charges credits per model (see models); a model that skipped web search when asked to is retried once, which can double that model's cost. Answers are cached for 7 days. Hosted accounts require a paid plan.",
    inputSchema: exploreAiPromptInputSchema,
    outputSchema: z
      .object({
        prompt: z.string(),
        highlightBrand: z.string().nullable(),
        results: z.array(looseObjectOutputSchema),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ExploreAiPromptArgs, context) => {
    const country = args.webSearchCountryCode
      ? webSearchCountryCodeSchema.safeParse(
          args.webSearchCountryCode.toUpperCase(),
        )
      : null;
    if (country && !country.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Unknown country code '${args.webSearchCountryCode}'. Use an ISO 3166-1 alpha-2 code such as 'ES' or 'US'.`,
      );
    }
    await assertAiSearchAccess(context.auth.organizationId);
    const result = trimPromptResult(
      await explorePrompt(
        {
          projectId: args.projectId,
          prompt: args.prompt,
          models: args.models,
          highlightBrand: args.highlightBrand,
          webSearch: args.webSearch ?? true,
          webSearchCountryCode: country?.data,
        },
        context.billing,
      ),
    );
    return mcpResponse({
      text: promptResultText(result),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/prompt-explorer`,
        { q: args.prompt, hb: args.highlightBrand },
      ),
      structuredContent: result,
    });
  }),
};
