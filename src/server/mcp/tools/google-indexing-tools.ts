/**
 * The Google Indexing API connection over MCP: the check, and the lines
 * get_indexing_setup prints about it. Free: Google's token endpoint and the
 * Indexing API charge nothing.
 */
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  GoogleIndexingService,
  type GoogleIndexingView,
} from "@/server/features/indexing/GoogleIndexingService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const indexingPath = (projectId: string) => `/p/${projectId}/indexing`;
const projectOnlyInput = { projectId: projectIdSchema } as const;
type ProjectArgs = { projectId: string };

/** One line on the Google Indexing API connection, for text output. */
export function googleIndexingLine(google: GoogleIndexingView): string {
  if (google.status === "not_configured") {
    return "- Google Indexing API (job-posting pages only): not set up.";
  }
  const since = google.statusChangedAt
    ? ` ${google.status === "ok" ? "Working" : "Failing"} since ${google.statusChangedAt}.`
    : "";
  return `- Google Indexing API (job-posting pages only): ${google.status}, service account ${google.clientEmail}, checked with ${google.sampleUrl ?? "(no sample URL)"} at ${google.lastCheckedAt ?? "never"}.${since} ${google.reason}`;
}

/** The Google Indexing API's fix as one actionNeeded line, when it fails. */
export function googleIndexingAction(google: GoogleIndexingView): string[] {
  if (google.status === "ok" || google.status === "not_configured") return [];
  return [
    `Google Indexing API (${google.status}): ${google.reason} Fix: ${google.steps.join(" ")}`,
  ];
}

export const googleIndexingOutputSchema = z.looseObject({
  status: z.string(),
  reason: z.string(),
  steps: z.array(z.string()),
  fixUrl: z.string().nullable(),
  clientEmail: z.string().nullable(),
  sampleUrl: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  statusChangedAt: z.string().nullable(),
});

export const checkGoogleIndexingTool = {
  name: "check_google_indexing",
  config: {
    title: "Check the Google Indexing API connection",
    description:
      "Check the project's Google Indexing API service account now, read-only: mint a token with the saved key, then read urlNotifications/metadata for the sample URL (the domain's home page unless one was chosen). Sends no notification. Returns the status (ok, not_configured, invalid_key, api_disabled, not_owner, quota_exceeded, error), the reason, the exact fix steps, and the service account email to add as an Owner in Search Console. The Indexing API is only for pages with JobPosting or BroadcastEvent structured data. The key itself is pasted in the app, never through MCP. OpenSEO also runs this check daily. Requires an organization owner or admin. Uses no credits.",
    inputSchema: projectOnlyInput,
    outputSchema: googleIndexingOutputSchema.extend(optionalMetaOutputSchema),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(async (args: ProjectArgs, context) => {
    requireOrgPermission(context.auth, { integration: ["manage"] });
    const google = await GoogleIndexingService.check(args.projectId);
    return mcpResponse({
      text: [
        googleIndexingLine(google),
        ...google.steps.map((step, index) => `${index + 1}. ${step}`),
      ].join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        indexingPath(args.projectId),
      ),
      structuredContent: google,
    });
  }),
};
