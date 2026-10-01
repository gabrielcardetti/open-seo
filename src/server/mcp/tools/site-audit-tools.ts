import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { AuditService } from "@/server/features/audit/services/AuditService";
import { AppError } from "@/server/lib/errors";
import { captureServerEvent } from "@/server/lib/posthog";
import { PAGE_FETCH_CLASSES } from "@/shared/audit-fetch-class";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const auditIdSchema = z
  .string()
  .optional()
  .describe("Audit ID. If omitted, uses the project's most recent audit.");

async function resolveAudit(projectId: string, auditId?: string) {
  const audit = auditId
    ? await AuditRepository.getAuditForProject(auditId, projectId)
    : await AuditRepository.getLatestAuditForProject(projectId);
  if (!audit) {
    throw new AppError(
      "NOT_FOUND",
      auditId
        ? `Audit ${auditId} not found in this project.`
        : "No audits exist for this project yet. Start one with run_site_audit.",
    );
  }
  return audit;
}

function auditPath(projectId: string, auditId: string) {
  return `/p/${projectId}/audit?auditId=${auditId}`;
}

// ─── run_site_audit ──────────────────────────────────────────────────────────

const runInputSchema = {
  projectId: projectIdSchema,
  url: z.string().min(1).max(2048).describe("Start URL to crawl."),
  maxPages: z
    .number()
    .int()
    .min(10)
    .max(10_000)
    .optional()
    .describe("Page budget for the crawl (default 50)."),
  runLighthouse: z
    .boolean()
    .optional()
    .describe(
      "Run Lighthouse on a sample of up to 10 representative pages (default false — it adds several minutes of wall-clock time). Pass true only when the user wants performance/Core Web Vitals detail.",
    ),
  evaluateContent: z
    .boolean()
    .optional()
    .describe(
      "Also judge a sample of pages against Google's official content guidelines (people-first, E-E-A-T, spam policies, AI guidance) and give each a verdict (default false). Read the result with get_guideline_results. To judge with your own model instead, leave this off and use get_guidelines_evaluation_batch.",
    ),
  includePaths: z
    .array(z.string().max(2048))
    .max(20)
    .optional()
    .describe(
      'Keep the crawl inside these sections of the site, as path prefixes such as "/bopv" (a full URL works too), matched on whole path segments like excludePaths. Only pages under them are seeded from sitemaps or followed from links, so the page budget goes to that section alone. The start URL must be inside one of them. Orphan pages are not reported for a crawl kept to some sections: links into them from the rest of the site were never seen.',
    ),
  excludePaths: z
    .array(z.string().max(2048))
    .max(20)
    .optional()
    .describe(
      'Sections of the site to leave out of the crawl, as path prefixes such as "/archive" (a full URL works too). Matched on whole path segments: "/archive" excludes /archive, /archive/2024/x and /archive?page=2, not /archives. Excluded pages are neither seeded from sitemaps nor followed from links, so they spend no page budget and add no findings. Use it for large generated sections the user wants audited separately or not at all.',
    ),
} as const;

type RunArgs = z.infer<z.ZodObject<typeof runInputSchema>>;

export const runSiteAuditTool = {
  name: "run_site_audit",
  config: {
    title: "Run site audit",
    description:
      "Start a site audit: crawls the site (robots.txt-aware, same-origin), checks every page for SEO issues (broken links, duplicate/missing titles and descriptions, redirect chains, orphan pages, canonical problems, thin content, and more), and optionally runs Lighthouse on a sample of pages. Runs in the background — poll get_audit_status, then read get_audit_issues. If the site rate limits the crawler it slows down and retries; pages it still cannot read are honestly flagged as blocked or rate-limited rather than misreported.",
    inputSchema: runInputSchema,
    outputSchema: z
      .object({
        // Expected refusal responses (for example, account audit capacity)
        // do not start an audit and therefore have no id.
        auditId: z.string().optional(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: RunArgs, context) => {
    // Default OFF for agent calls: Lighthouse turns a 1-2 minute crawl into a
    // many-minute wait, which chat agents handle badly. The app UI passes its
    // own explicit lighthouseStrategy, so this default only governs agents.
    const lighthouseStrategy = (args.runLighthouse ?? false) ? "auto" : "none";
    const guidelinesStrategy =
      (args.evaluateContent ?? false) ? "sample" : "none";
    const limitTier = await AuditService.resolveAuditLimitTier(context.billing);
    let auditId: string;
    try {
      ({ auditId } = await AuditService.startAudit({
        actorUserId: context.auth.userId,
        billingCustomer: context.billing,
        projectId: args.projectId,
        startUrl: args.url,
        maxPages: args.maxPages,
        lighthouseStrategy,
        guidelinesStrategy,
        includedPaths: args.includePaths,
        excludedPaths: args.excludePaths,
        limitTier,
      }));
    } catch (error) {
      // Expected refusals become readable answers instead of protocol errors:
      // no audit started, so there is no auditId to report.
      const refusalText =
        error instanceof AppError && error.code === "AUDIT_CAPACITY_REACHED"
          ? "Audit capacity reached for this account — delete old audits in the dashboard to free capacity, then try again."
          : error instanceof AppError && error.code === "AUDIT_ALREADY_RUNNING"
            ? "This account is at its limit of concurrently running audits. Poll get_audit_status until one finishes, then try again."
            : null;
      if (refusalText) {
        return mcpResponse({
          text: refusalText,
          meta: buildProjectMeta(
            context,
            args.projectId,
            `/p/${args.projectId}/audit`,
          ),
        });
      }
      throw error;
    }

    await captureServerEvent({
      distinctId: context.auth.userId,
      event: "site_audit:start",
      organizationId: context.auth.organizationId,
      properties: {
        project_id: args.projectId,
        max_pages: args.maxPages ?? 50,
        run_lighthouse: lighthouseStrategy !== "none",
        source: "mcp",
      },
    });

    return mcpResponse({
      text: `Audit ${auditId} started for ${args.url}. Wait for it with get_audit_status (pass waitSeconds: 50 and repeat until it finishes), then call get_audit_issues for the prioritized issue report (even a failed audit keeps results for every page it crawled).`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, auditId),
      ),
      structuredContent: { auditId },
    });
  }),
};

// ─── get_audit_status ────────────────────────────────────────────────────────

/** Below the ~60s request timeout common MCP clients apply to a tool call. */
const MAX_WAIT_SECONDS = 50;
const WAIT_POLL_MS = 5_000;

const statusInputSchema = {
  projectId: projectIdSchema,
  auditId: auditIdSchema,
  waitSeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_SECONDS)
    .optional()
    .describe(
      `Hold the call open up to this many seconds (max ${MAX_WAIT_SECONDS}) and return as soon as the audit finishes, instead of returning the current progress at once. Call again with the same value to keep waiting; a 400-page crawl takes several minutes.`,
    ),
} as const;

type StatusArgs = z.infer<z.ZodObject<typeof statusInputSchema>>;

export const getAuditStatusTool = {
  name: "get_audit_status",
  config: {
    title: "Get site audit status",
    description:
      "Check the progress of a site audit (phase, pages crawled, Lighthouse progress). Pass waitSeconds to wait for it to finish within the call instead of polling. Free — reads OpenSEO state and may reconcile a dead workflow by marking its audit failed. Omit auditId for the most recent audit.",
    inputSchema: statusInputSchema,
    outputSchema: z
      .object({
        status: looseObjectOutputSchema,
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: StatusArgs, context) => {
    // getStatus fetches (and self-heals) the audit row itself; only hit the
    // DB here when we need to default to the most recent audit.
    const auditId = args.auditId ?? (await resolveAudit(args.projectId)).id;
    let status = await AuditService.getStatus(auditId, args.projectId);
    const deadline = Date.now() + (args.waitSeconds ?? 0) * 1000;
    while (status.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(WAIT_POLL_MS, deadline - Date.now())),
      );
      status = await AuditService.getStatus(auditId, args.projectId);
    }

    const lighthouseNote =
      status.lighthouseTotal > 0
        ? `, lighthouse ${status.lighthouseCompleted + status.lighthouseFailed}/${status.lighthouseTotal}`
        : "";
    // Failed audits keep partial results — point agents at them instead of
    // letting a mid-crawl death read as "no data".
    const nextStep =
      status.status === "completed"
        ? " Call get_audit_issues for the issue report."
        : status.status === "failed" && status.pagesCrawled > 0
          ? ` The audit stopped early but kept results for the ${status.pagesCrawled} pages it crawled — call get_audit_issues for the partial issue report.`
          : "";
    return mcpResponse({
      text: `Audit ${status.id} (${status.startUrl}): ${status.status} — phase ${status.currentPhase}, ${status.pagesCrawled}/${status.pagesTotal} pages${lighthouseNote}.${nextStep}`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, status.id),
      ),
      structuredContent: { status },
    });
  }),
};

// ─── get_audit_issues ────────────────────────────────────────────────────────

export { getAuditIssuesTool } from "@/server/mcp/tools/audit-issues-tool";

// ─── get_audit_pages ─────────────────────────────────────────────────────────

const pagesInputSchema = {
  projectId: projectIdSchema,
  auditId: auditIdSchema,
  fetchClass: z
    .enum(PAGE_FETCH_CLASSES)
    .optional()
    .describe(
      'Filter by fetch outcome ("blocked" = the site\'s bot protection challenged the crawler; "rate_limited" = a 429 prevented the crawler from reading the page).',
    ),
  statusCode: z
    .number()
    .int()
    .optional()
    .describe("Filter by exact HTTP status code."),
  urlContains: z
    .string()
    .optional()
    .describe("Filter to URLs containing this substring."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1_000)
    .optional()
    .describe("Max pages to return (default 100)."),
} as const;

type PagesArgs = z.infer<z.ZodObject<typeof pagesInputSchema>>;

export const getAuditPagesTool = {
  name: "get_audit_pages",
  config: {
    title: "Get site audit pages",
    description:
      "List crawled pages from a site audit with per-page SEO data (status, title, description, word count, indexability, crawl depth, link counts). Free — reads OpenSEO state. Omit auditId for the most recent audit.",
    inputSchema: pagesInputSchema,
    outputSchema: z
      .object({
        pages: z.array(looseObjectOutputSchema),
        total: z.number(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: PagesArgs, context) => {
    const audit = await resolveAudit(args.projectId, args.auditId);
    const allPages = await AuditRepository.getPagesForAudit(audit.id);

    const filtered = allPages.filter(
      (page) =>
        (!args.fetchClass || page.fetchClass === args.fetchClass) &&
        (args.statusCode === undefined ||
          page.statusCode === args.statusCode) &&
        (!args.urlContains || page.url.includes(args.urlContains)),
    );
    const limit = args.limit ?? 100;
    const pages = filtered.slice(0, limit);

    const text = [
      `Audit ${audit.id}: ${filtered.length} pages${filtered.length > limit ? ` (showing ${limit})` : ""}.`,
      ...pages
        .slice(0, 25)
        .map(
          (page) =>
            `- ${page.statusCode} ${page.url}${page.fetchClass !== "ok" ? ` [${page.fetchClass}]` : ""}  "${page.title ?? ""}"`,
        ),
      "Full rows are in structuredContent.pages.",
    ].join("\n");

    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      structuredContent: { pages, total: filtered.length },
    });
  }),
};
