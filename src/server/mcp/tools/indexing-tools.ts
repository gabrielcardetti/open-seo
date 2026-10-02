/**
 * MCP tools for indexing: the IndexNow / Bing URL submission setup, sending
 * URLs, the per-URL ledger, and a preview of what the sitemap watch would
 * send. All free: neither IndexNow nor Bing's API charges credits.
 */
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { IndexingService } from "@/server/features/indexing/IndexingService";
import { SitemapWatchService } from "@/server/features/indexing/SitemapWatchService";
import { UrlSubmissionService } from "@/server/features/indexing/UrlSubmissionService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, truncatedCell } from "@/server/mcp/table";
import {
  URL_SUBMISSION_CHANNELS,
  URL_SUBMISSION_SOURCES,
  URL_SUBMISSION_STATUSES,
} from "@/shared/indexing";
import {
  INDEXING_CHANNEL_CHOICES,
  MAX_SUBMIT_URLS,
} from "@/types/schemas/indexing";

const indexingPath = (projectId: string) => `/p/${projectId}/indexing`;
/** URL lists in responses are capped; counts are always exact. */
const MAX_LISTED = 100;

const readAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

const projectOnlyInput = { projectId: projectIdSchema } as const;
type ProjectArgs = { projectId: string };

const statusSummary = (counts: Partial<Record<string, number>>) =>
  Object.entries(counts)
    .map(([status, total]) => `${status} ${total}`)
    .join(", ") || "none";

export const getIndexingSetupTool = {
  name: "get_indexing_setup",
  config: {
    title: "Get indexing setup",
    description:
      "How this project announces new and changed URLs to search engines: the IndexNow key, the exact key file to publish and where, whether it is verified, auto-submit and the dedupe window, the deploy hook URL, the last daily sitemap check, the Bing connection's URL submission quota, and which channel `auto` would use. Free — reads OpenSEO state.",
    inputSchema: projectOnlyInput,
    outputSchema: z.looseObject({
      indexNow: looseObjectOutputSchema.optional(),
      autoChannel: z.string().nullable().optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: readAnnotations,
  },
  handler: withMcpProjectAuth(async (args: ProjectArgs, context) => {
    const setup = await IndexingService.getSetup(
      args.projectId,
      context.baseUrl,
    );
    const { indexNow } = setup;
    const lines = [
      `Indexing for ${setup.host ?? "(no domain set)"}:`,
      indexNow.key
        ? `- IndexNow key ${indexNow.key}, file ${indexNow.keyFileUrl ?? "(set a domain)"} must contain exactly the key. ${indexNow.verifiedAt ? `Verified ${indexNow.verifiedAt}.` : `Not verified${indexNow.lastError ? `: ${indexNow.lastError}` : "."}`}`
        : "- No IndexNow key yet (generate or import one in the app).",
      `- Bing URL submission: ${setup.bing ? `connected (${setup.bing.siteUrl}), daily quota left ${setup.bing.dailyQuotaRemaining ?? "unknown"}` : "not connected"}.`,
      `- Channel used by auto: ${setup.autoChannel ?? "none — set up IndexNow or connect Bing"}.`,
      `- Auto-submit ${setup.autoSubmitEnabled ? "on" : "off"}; dedupe window ${setup.dedupeHours} h.`,
      `- Deploy hook ${setup.deployHook.configured ? "configured" : "not configured"}: POST ${setup.deployHook.url}`,
      `- Last sitemap check: ${setup.sitemap.lastCheckAt ?? "never"}${setup.sitemap.lastError ? ` (${setup.sitemap.lastError})` : ""}.`,
    ];
    return mcpResponse({
      text: lines.join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        indexingPath(args.projectId),
      ),
      structuredContent: setup,
    });
  }),
};

export const verifyIndexNowKeyTool = {
  name: "verify_indexnow_key",
  config: {
    title: "Verify the IndexNow key file",
    description:
      "Fetch the project's IndexNow key file from the site, the way IndexNow will, and record whether it holds exactly the key. Once verified, submit_urls_for_indexing with channel auto uses IndexNow. Requires an organization owner or admin. Uses no credits.",
    inputSchema: projectOnlyInput,
    outputSchema: z.looseObject({
      verified: z.boolean(),
      verifiedAt: z.string().nullable(),
      error: z.string().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(async (args: ProjectArgs, context) => {
    requireOrgPermission(context.auth, { integration: ["manage"] });
    const result = await IndexingService.verifyKey(args.projectId);
    return mcpResponse({
      text: result.verified
        ? `IndexNow key verified at ${result.verifiedAt}.`
        : `Not verified: ${result.error}`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        indexingPath(args.projectId),
      ),
      structuredContent: result,
    });
  }),
};

const submitInput = {
  projectId: projectIdSchema,
  urls: z
    .array(z.string().max(2048))
    .min(1)
    .max(MAX_SUBMIT_URLS)
    .describe(
      "Absolute URLs on the project's site (www and the apex count as the same site). Others are dropped and listed.",
    ),
  channel: z
    .enum(INDEXING_CHANNEL_CHOICES)
    .optional()
    .describe(
      "auto (default): IndexNow when its key is verified, else Bing's URL submission API when Bing is connected. indexnow / bing_api force one.",
    ),
  force: z
    .boolean()
    .optional()
    .describe(
      "Send URLs even if they were announced successfully within the dedupe window.",
    ),
} as const;

export const submitUrlsForIndexingTool = {
  name: "submit_urls_for_indexing",
  config: {
    title: "Submit URLs for indexing",
    description:
      "Announce new or changed URLs of the project's site to search engines via IndexNow (Bing, Yandex, Naver, Seznam and other participants) or Bing's URL submission API (daily quota; URLs past it come back skipped_quota). Google does not participate in IndexNow; use inspect_urls or Search Console for Google. Each URL gets a ledger row and a status: received/pending mean the engine got the notice, not that the page is indexed; rejected/failed/throttled say why not. URLs announced successfully within the project's dedupe window (default 24 h) are skipped as skipped_duplicate unless force is true, so repeating a call is safe. Requires an organization owner or admin. Uses no credits.",
    inputSchema: submitInput,
    outputSchema: z.looseObject({
      ok: z.boolean(),
      problem: z.string().nullable(),
      channel: z.string().nullable(),
      counts: looseObjectOutputSchema,
      results: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof submitInput>>, context) => {
      requireOrgPermission(context.auth, { integration: ["manage"] });
      const result = await UrlSubmissionService.submitUrls(
        args.projectId,
        args.urls,
        "mcp",
        { channel: args.channel, force: args.force },
      );
      const lines = result.problem
        ? [`Nothing sent: ${result.problem}`]
        : [
            `${result.results.length} URL${result.results.length === 1 ? "" : "s"} via ${result.channel ?? "—"}: ${statusSummary(result.counts)}.`,
            ...result.results
              .filter(
                (row) => row.errorMessage && row.status !== "skipped_duplicate",
              )
              .slice(0, 10)
              .map((row) => `- ${row.status} ${row.url}: ${row.errorMessage}`),
          ];
      if (result.dropped.length > 0) {
        lines.push(
          `Dropped ${result.dropped.length} not on the project's site or invalid, e.g. ${result.dropped[0]?.url}.`,
        );
      }
      return mcpResponse({
        text: lines.join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          indexingPath(args.projectId),
        ),
        structuredContent: {
          ok: result.problem === null,
          problem: result.problem,
          batchId: result.batchId,
          channel: result.channel,
          counts: result.counts,
          results: result.results,
          dropped: result.dropped,
        },
      });
    },
  ),
};

const logInput = {
  projectId: projectIdSchema,
  url: z
    .string()
    .max(2048)
    .optional()
    .describe("Only URLs containing this text."),
  status: z.enum(URL_SUBMISSION_STATUSES).optional(),
  source: z.enum(URL_SUBMISSION_SOURCES).optional(),
  channel: z.enum(URL_SUBMISSION_CHANNELS).optional(),
  limit: z.number().int().min(1).max(500).optional().describe("Default 50."),
  offset: z.number().int().min(0).optional(),
} as const;

export const getIndexingLogTool = {
  name: "get_indexing_log",
  config: {
    title: "Get the indexing log",
    description:
      "The per-URL ledger of announcements to search engines, newest first, filterable by URL text, status, source (manual, mcp, sitemap, deploy_hook, audit) and channel, plus counts by status for the last 7 and 30 days. Use it to answer 'did we tell Bing about this page, and what did it say?'. Free — reads OpenSEO state.",
    inputSchema: logInput,
    outputSchema: z.looseObject({
      rows: z.array(looseObjectOutputSchema),
      total: z.number(),
      counts: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: readAnnotations,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof logInput>>, context) => {
      const { projectId, limit, offset, ...filters } = args;
      const log = await IndexingService.getLog(projectId, {
        ...filters,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
      const table =
        log.rows.length > 0
          ? formatMcpTable(log.rows, [
              { header: "submitted", value: (row) => row.submittedAt },
              { header: "status", value: (row) => row.status },
              { header: "channel", value: (row) => row.channel },
              { header: "source", value: (row) => row.source },
              { header: "url", value: (row) => row.url },
              {
                header: "detail",
                value: (row) => row.errorMessage,
                format: truncatedCell(80),
              },
            ])
          : "No submissions match.";
      return mcpResponse({
        text: [
          `${log.total} submissions match. Last 7 days: ${statusSummary(log.counts.last7Days)}. Last 30 days: ${statusSummary(log.counts.last30Days)}.`,
          table,
        ].join("\n"),
        meta: buildProjectMeta(context, projectId, indexingPath(projectId)),
        structuredContent: log,
      });
    },
  ),
};

export const getIndexingCandidatesTool = {
  name: "get_indexing_candidates",
  config: {
    title: "Preview sitemap indexing candidates",
    description:
      "Read the project's sitemaps now and compare them with the stored inventory: URLs that are new, whose <lastmod> moved (changed), and that disappeared (removed). This is what the daily sitemap check or the deploy hook would submit (one check sends at most 500 changed URLs; the rest wait for the next); nothing is recorded or sent. When the project has no inventory yet (baseline: true), the first check only records it and submits nothing. When nearly every lastmod moved to the current time (lastmodUnreliable: true), the sitemap stamps its generation time, so changed is empty and only new URLs would be sent. Lists are capped at 100; counts are exact. Uses no credits.",
    inputSchema: projectOnlyInput,
    outputSchema: z.looseObject({
      ok: z.boolean(),
      problem: z.string().optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: { ...readAnnotations, openWorldHint: true },
  },
  handler: withMcpProjectAuth(async (args: ProjectArgs, context) => {
    const meta = buildProjectMeta(
      context,
      args.projectId,
      indexingPath(args.projectId),
    );
    const outcome = await SitemapWatchService.previewCandidates(args.projectId);
    if (!outcome.ok) {
      return mcpResponse({
        text: outcome.problem,
        meta,
        structuredContent: { ok: false, problem: outcome.problem },
      });
    }
    const { diff } = outcome;
    return mcpResponse({
      text: [
        `${diff.origin}: ${diff.totalUrls} sitemap URLs${diff.truncated ? " (capped)" : ""}.`,
        diff.baseline
          ? "No inventory yet: the first check records these as the baseline and submits nothing."
          : `${diff.newUrls.length} new, ${diff.changedUrls.length} changed (would be submitted), ${diff.removedUrls.length} removed.`,
        ...(outcome.warning ? [outcome.warning] : []),
        ...[...diff.newUrls, ...diff.changedUrls]
          .slice(0, 20)
          .map((url) => `- ${url}`),
      ].join("\n"),
      meta,
      structuredContent: {
        ok: true,
        baseline: diff.baseline,
        origin: diff.origin,
        totalUrls: diff.totalUrls,
        truncated: diff.truncated,
        lastmodUnreliable: diff.lastmodUnreliable,
        newCount: diff.newUrls.length,
        changedCount: diff.changedUrls.length,
        removedCount: diff.removedUrls.length,
        newUrls: diff.newUrls.slice(0, MAX_LISTED),
        changedUrls: diff.changedUrls.slice(0, MAX_LISTED),
        removedUrls: diff.removedUrls.slice(0, MAX_LISTED),
      },
    });
  }),
};
