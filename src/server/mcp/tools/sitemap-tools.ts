/**
 * MCP tools for the project's sitemap registry: which sitemaps OpenSEO
 * tracks, whether Google Search Console and Bing Webmaster Tools have them,
 * and submitting the missing ones. All free: neither engine charges for
 * these calls.
 */
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { SitemapCoverageService } from "@/server/features/sitemaps/SitemapCoverageService";
import { SitemapSubmissionService } from "@/server/features/sitemaps/SitemapSubmissionService";
import { SitemapRegistryService } from "@/server/features/sitemaps/SitemapRegistryService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import { MAX_PROJECT_SITEMAPS } from "@/shared/sitemaps";
import {
  sitemapChangesSchema,
  sitemapSubmissionSchema,
} from "@/types/schemas/sitemaps";

const indexingPath = (projectId: string) => `/p/${projectId}/indexing`;
const projectOnlyInput = { projectId: projectIdSchema } as const;

const STATE_LABELS = {
  submitted: "yes",
  missing: "MISSING",
  not_connected: "not connected",
  unknown: "unknown",
} as const;

type Coverage = Awaited<ReturnType<typeof SitemapCoverageService.coverage>>;

function renderCoverage(coverage: Coverage): string {
  const lines: string[] = [];
  lines.push(
    coverage.tracked.length > 0
      ? formatMcpTable(coverage.tracked, [
          { header: "tracked sitemap", value: (row) => row.url },
          {
            header: "google",
            value: (row) =>
              `${STATE_LABELS[row.google.state]}${row.google.isPending ? " (pending)" : ""}${row.google.outsideProperty ? " (outside property)" : ""}`,
          },
          {
            header: "google indexed/submitted",
            value: (row) =>
              row.google.submitted === null
                ? "—"
                : `${row.google.indexed ?? 0}/${row.google.submitted}`,
          },
          { header: "google errors", value: (row) => row.google.errors },
          {
            header: "bing",
            value: (row) =>
              `${STATE_LABELS[row.bing.state]}${row.bing.status ? ` (${row.bing.status})` : ""}`,
          },
          { header: "bing urls", value: (row) => row.bing.urlCount ?? "—" },
        ])
      : "No tracked sitemaps.",
  );
  if (coverage.suggested.length > 0) {
    lines.push(
      "",
      "Suggested (confirm with update_sitemaps track or ignore):",
      ...coverage.suggested.map((row) => `- ${row.url}`),
    );
  }
  if (coverage.engineOnly.length > 0) {
    lines.push(
      "",
      "Registered in an engine but unknown to OpenSEO (track or ignore):",
      ...coverage.engineOnly.map(
        (row) =>
          `- ${row.url} (${[row.google ? "Google" : null, row.bing ? "Bing" : null].filter(Boolean).join(", ")})`,
      ),
    );
  }
  lines.push(
    "",
    `Search Console: ${coverage.google.connected ? `${coverage.google.siteUrl}, ${coverage.google.canSubmit ? "can submit sitemaps" : "read-only (reconnect to submit)"}` : "not connected"}. Bing: ${coverage.bing.connected ? `${coverage.bing.siteUrl}, last synced ${coverage.bing.lastSyncedAt ?? "never"}` : "not connected"}.`,
    "",
    coverage.actionNeeded.length > 0
      ? ["Action needed:", ...coverage.actionNeeded.map((a) => `- ${a}`)].join(
          "\n",
        )
      : "Nothing to do: every tracked sitemap is registered where connected.",
  );
  return lines.join("\n");
}

const coverageOutputSchema = z.looseObject({
  tracked: z.array(looseObjectOutputSchema),
  suggested: z.array(looseObjectOutputSchema),
  engineOnly: z.array(looseObjectOutputSchema),
  actionNeeded: z.array(z.string()),
  ...optionalMetaOutputSchema,
});

export const getSitemapsTool = {
  name: "get_sitemaps",
  config: {
    title: "Get the project's sitemaps",
    description:
      "The sitemaps OpenSEO tracks for this project and whether Google Search Console and Bing Webmaster Tools have each one: Google's state (submitted, missing, pending, errors, warnings, submitted/indexed URL counts) read live, Bing's (status, URL count, last crawl) from the last sync. Also lists sitemaps OpenSEO detected but the user hasn't confirmed (suggested), sitemaps registered in Google or Bing that OpenSEO doesn't track (engineOnly, often stale ones), whether Search Console can submit (gscCanSubmit; false means reconnect Search Console once), and actionNeeded in plain language. Call this when setting up a project or after connecting Search Console or Bing, then confirm sitemaps with the user via update_sitemaps and register missing ones with submit_sitemaps. Uses no credits.",
    inputSchema: projectOnlyInput,
    outputSchema: coverageOutputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const coverage = await SitemapCoverageService.coverage(args.projectId);
    return mcpResponse({
      text: renderCoverage(coverage),
      meta: buildProjectMeta(
        context,
        args.projectId,
        indexingPath(args.projectId),
      ),
      structuredContent: coverage,
    });
  }),
};

const updateInput = {
  projectId: projectIdSchema,
  track: sitemapChangesSchema.shape.track.describe(
    "Sitemap URLs to track: confirms suggestions, or adds a URL OpenSEO doesn't hold yet (it must answer 200 with XML).",
  ),
  ignore: sitemapChangesSchema.shape.ignore.describe(
    "Sitemap URLs to ignore: they are never suggested again and drop out of engineOnly.",
  ),
  add: sitemapChangesSchema.shape.add.describe(
    "Sitemap URLs the user knows about, tracked directly. Absolute https URLs on the project's site that answer 200 with XML.",
  ),
  remove: sitemapChangesSchema.shape.remove.describe(
    "Tracked sitemap URLs to stop tracking. Detected ones become ignored so detection doesn't suggest them again.",
  ),
  detect: sitemapChangesSchema.shape.detect.describe(
    "Read robots.txt and /sitemap.xml now and suggest the site's sitemaps (runs before the other changes).",
  ),
} as const;

export const updateSitemapsTool = {
  name: "update_sitemaps",
  config: {
    title: "Update the project's sitemaps",
    description: `Confirm, ignore, add, or remove the sitemaps OpenSEO tracks for this project, or detect them from robots.txt and /sitemap.xml. Tracked sitemaps are what OpenSEO compares with Google and Bing, what the Bing sync registers, and what the sitemap watch reads for IndexNow. Confirm with the user before tracking or ignoring. At most ${MAX_PROJECT_SITEMAPS} sitemaps per project. Returns the updated registry with coverage. Requires an organization owner or admin. Uses no credits.`,
    inputSchema: updateInput,
    outputSchema: z.looseObject({
      changes: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      // Removing a sitemap added by hand forgets it.
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof updateInput>>, context) => {
      requireOrgPermission(context.auth, { integration: ["manage"] });
      const { projectId, ...changes } = args;
      const result = await SitemapRegistryService.update(projectId, changes);
      const coverage = await SitemapCoverageService.coverage(projectId);
      const lines = [
        ...(result.detected
          ? [
              result.detected.problem
                ? `Detection failed: ${result.detected.problem}`
                : `Detection suggested ${result.detected.suggested.length} new sitemap(s).`,
            ]
          : []),
        ...result.changes.map(
          (change) =>
            `- ${change.action} ${change.url}: ${change.ok ? "done" : change.problem}`,
        ),
        "",
        renderCoverage(coverage),
      ];
      return mcpResponse({
        text: lines.join("\n"),
        meta: buildProjectMeta(context, projectId, indexingPath(projectId)),
        structuredContent: { ...result, coverage },
      });
    },
  ),
};

const submitInput = {
  projectId: projectIdSchema,
  urls: sitemapSubmissionSchema.shape.urls.describe(
    "Tracked sitemap URLs to submit. Omit for every tracked sitemap.",
  ),
  engines: z
    .array(z.enum(["google", "bing"]))
    .min(1)
    .optional()
    .describe("Engines to submit to. Default both."),
  onlyMissing: z
    .boolean()
    .optional()
    .describe(
      "Skip sitemaps the engine already lists (default true). Google discourages resubmitting sitemaps it knows.",
    ),
} as const;

export const submitSitemapsTool = {
  name: "submit_sitemaps",
  config: {
    title: "Submit sitemaps to Google and Bing",
    description:
      "Register the project's tracked sitemaps with Google Search Console (sitemaps.submit) and/or Bing Webmaster Tools (SubmitFeed). By default only sitemaps the engine doesn't list yet are sent. Google needs a Search Console connection with write access: when it is read-only the result says reason reconnect_required and the user must reconnect Search Console once. A URL-prefix Search Console property only accepts sitemaps under its prefix. Results are per engine and per sitemap. Requires an organization owner or admin. Uses no credits.",
    inputSchema: submitInput,
    outputSchema: z.looseObject({
      google: looseObjectOutputSchema.nullable().optional(),
      bing: looseObjectOutputSchema.nullable().optional(),
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
      const result = await SitemapSubmissionService.submitToEngines(
        args.projectId,
        {
          urls: args.urls,
          engines: args.engines ?? ["google", "bing"],
          onlyMissing: args.onlyMissing ?? true,
        },
      );
      const lines = (["google", "bing"] as const).flatMap((engine) => {
        const outcome = result[engine];
        if (!outcome) return [];
        const name = engine === "google" ? "Google" : "Bing";
        if (outcome.problem && outcome.results.length === 0) {
          return [`${name}: nothing sent. ${outcome.problem}`];
        }
        return [
          `${name}:${outcome.problem ? ` ${outcome.problem}` : ""}`,
          ...(outcome.results.length > 0
            ? outcome.results.map(
                (row) =>
                  `- ${row.status} ${row.url}${row.detail ? `: ${row.detail}` : ""}`,
              )
            : ["- no tracked sitemaps to send"]),
        ];
      });
      return mcpResponse({
        text: lines.join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          indexingPath(args.projectId),
        ),
        structuredContent: result,
      });
    },
  ),
};
