/** Capability checks: the `.well-known` documents an API or app publishes. */
import {
  describe,
  isHtml,
  type CheckContext,
  type CheckDefinition,
  type CheckResult,
} from "./check-types";

const API_ONLY = ["apiApp"] as const;

/**
 * A `.well-known` JSON document. Status, content type and a parseable body are
 * all required: a site that answers every path with its HTML shell would
 * otherwise pass every one of these.
 */
async function wellKnownJson(
  ctx: CheckContext,
  paths: string[],
  requiredKey: string | null,
): Promise<Omit<CheckResult, "checkId" | "category" | "fixUrl">> {
  const seen: string[] = [];
  for (const path of paths) {
    const response = await ctx.probe(`${ctx.origin}${path}`);
    seen.push(`${path}: ${describe(response)}`);
    if (!response || response.status !== 200) continue;
    if (isHtml(response)) {
      return {
        status: "fail",
        message: `${path} answers with an HTML page, not a JSON document — likely the site's soft 404.`,
        evidence: seen.join(" | "),
      };
    }
    try {
      const parsed: unknown = JSON.parse(response.body);
      if (
        requiredKey &&
        (typeof parsed !== "object" ||
          parsed === null ||
          !(requiredKey in parsed))
      ) {
        return {
          status: "fail",
          message: `${path} is JSON but has no "${requiredKey}" field.`,
          evidence: seen.join(" | "),
        };
      }
      return {
        status: "pass",
        message: `${path} is published.`,
        evidence: seen.join(" | "),
      };
    } catch {
      return {
        status: "fail",
        message: `${path} exists but is not valid JSON.`,
        evidence: seen.join(" | "),
      };
    }
  }
  return {
    status: "fail",
    message: `Not published (${paths.join(", ")}).`,
    evidence: seen.join(" | "),
  };
}

export const CAPABILITY_CHECKS: CheckDefinition[] = [
  {
    id: "apiCatalog",
    category: "capabilities",
    profiles: API_ONLY,
    fixUrl: "https://www.rfc-editor.org/rfc/rfc9727",
    run: (ctx) => wellKnownJson(ctx, ["/.well-known/api-catalog"], "linkset"),
  },
  {
    id: "oauthDiscovery",
    category: "capabilities",
    profiles: API_ONLY,
    fixUrl: "https://www.rfc-editor.org/rfc/rfc8414",
    run: (ctx) =>
      wellKnownJson(
        ctx,
        [
          "/.well-known/oauth-authorization-server",
          "/.well-known/openid-configuration",
        ],
        "issuer",
      ),
  },
  {
    id: "oauthProtectedResource",
    category: "capabilities",
    profiles: API_ONLY,
    fixUrl: "https://www.rfc-editor.org/rfc/rfc9728",
    run: (ctx) =>
      wellKnownJson(ctx, ["/.well-known/oauth-protected-resource"], "resource"),
  },
  {
    id: "mcpServerCard",
    category: "capabilities",
    profiles: API_ONLY,
    fixUrl: null,
    run: (ctx) =>
      wellKnownJson(ctx, ["/.well-known/mcp/server-card.json"], null),
  },
  {
    id: "a2aAgentCard",
    category: "capabilities",
    profiles: API_ONLY,
    fixUrl: null,
    run: (ctx) =>
      wellKnownJson(
        ctx,
        ["/.well-known/agent-card.json", "/.well-known/agent.json"],
        null,
      ),
  },
  {
    id: "agentSkills",
    category: "capabilities",
    profiles: API_ONLY,
    fixUrl: null,
    run: (ctx) =>
      wellKnownJson(ctx, ["/.well-known/agent-skills/index.json"], null),
  },
];
