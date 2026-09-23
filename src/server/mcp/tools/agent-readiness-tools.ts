/**
 * MCP tools for agent readiness: scan a project's site, and read the latest
 * result with its history.
 */
import { z } from "zod";
import { AgentReadinessService } from "@/server/features/agent-readiness/AgentReadinessService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { AGENT_READINESS_PROFILES } from "@/server/lib/agent-readiness/check-types";

const pagePath = (projectId: string) => `/p/${projectId}/agent-readiness`;

async function renderOverview(projectId: string) {
  const overview = await AgentReadinessService.getOverview(projectId);
  const latest = overview.latest;
  if (!latest) {
    return {
      structured: { latest: null, checks: [], history: [] },
      text: "No agent-readiness scan yet. Run run_agent_readiness_scan.",
    };
  }

  // Actionable first: what fails in our checks, then where the engines split.
  const failing = overview.checks.filter((c) => c.openseo?.status === "fail");
  const disagreements = overview.checks.filter((c) => c.agree === false);
  const lines = [
    `Agent readiness for ${latest.origin} (${latest.profile} profile), scanned ${latest.startedAt}:`,
    `- OpenSEO: ${latest.passed}/${latest.applicable} applicable checks pass`,
    `- Cloudflare: ${latest.cloudflareStatus === "ok" && latest.cloudflareLevel !== null ? `level ${latest.cloudflareLevel}/5` : "scanner unavailable"}`,
  ];
  if (failing.length > 0) {
    lines.push("", "Failing (OpenSEO):");
    for (const check of failing) {
      lines.push(`- ${check.checkId}: ${check.openseo?.message ?? ""}`);
    }
  }
  if (disagreements.length > 0) {
    lines.push(
      "",
      `Engines disagree on: ${disagreements.map((c) => c.checkId).join(", ")}`,
    );
  }
  if (overview.history.length > 1) {
    lines.push("", "History (newest first):");
    for (const scan of overview.history.slice(0, 10)) {
      lines.push(
        `- ${scan.startedAt}: ${scan.status === "completed" ? `${scan.passed}/${scan.applicable}` : scan.status}${scan.cloudflareLevel !== null ? `, Cloudflare ${scan.cloudflareLevel}/5` : ""}`,
      );
    }
  }

  return {
    structured: {
      latest,
      checks: overview.checks,
      history: overview.history.map((scan) => ({
        startedAt: scan.startedAt,
        status: scan.status,
        passed: scan.passed,
        applicable: scan.applicable,
        cloudflareLevel: scan.cloudflareLevel,
      })),
    },
    text: lines.join("\n"),
  };
}

const outputSchema = z
  .object({
    latest: looseObjectOutputSchema.nullable(),
    checks: z.array(looseObjectOutputSchema),
    history: z.array(looseObjectOutputSchema),
    ...optionalMetaOutputSchema,
  })
  .passthrough();

export const getAgentReadinessTool = {
  name: "get_agent_readiness",
  config: {
    title: "Get agent readiness",
    description:
      "Read the latest agent-readiness scan of the project's site — how well AI agents can discover, read and use it — with each check from OpenSEO and from Cloudflare's scanner side by side, the evidence and fix for each, and the scan history. Free — reads OpenSEO state.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const { structured, text } = await renderOverview(args.projectId);
    return mcpResponse({
      text,
      structuredContent: structured,
      meta: buildProjectMeta(context, args.projectId, pagePath(args.projectId)),
    });
  }),
};

export const runAgentReadinessScanTool = {
  name: "run_agent_readiness_scan",
  config: {
    title: "Scan agent readiness",
    description:
      "Scan the project's site for AI-agent readiness now: robots.txt AI rules and Content Signals, markdown for agents, missing pages that wrongly answer 200 (soft 404), content visible without JavaScript, whether AI crawler user-agents are served, and — for products — API, OAuth and MCP discovery documents. Runs OpenSEO's checks and Cloudflare's scanner together and returns the comparison. Free. Takes up to a minute.",
    inputSchema: {
      projectId: projectIdSchema,
      profile: z
        .enum(AGENT_READINESS_PROFILES)
        .optional()
        .describe(
          'Which checks apply, saved for later scans: "content" for a content or marketing site, "apiApp" for a product with a public API (adds API, OAuth, MCP and A2A discovery). Omit to keep the project\'s current profile.',
        ),
    },
    outputSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        profile?: (typeof AGENT_READINESS_PROFILES)[number];
      },
      context,
    ) => {
      if (args.profile) {
        const { config } = await AgentReadinessService.getOverview(
          args.projectId,
        );
        await AgentReadinessService.updateConfig({
          projectId: args.projectId,
          profile: args.profile,
          scheduleEnabled: config.scheduleEnabled,
        });
      }
      await AgentReadinessService.runScan({
        projectId: args.projectId,
        domain: context.project.domain,
        trigger: "manual",
      });
      const { structured, text } = await renderOverview(args.projectId);
      return mcpResponse({
        text,
        structuredContent: structured,
        meta: buildProjectMeta(
          context,
          args.projectId,
          pagePath(args.projectId),
        ),
      });
    },
  ),
};
