import {
  getOrCreateOrganizationCustomer,
  getUsageCreditsRemaining,
} from "@/server/billing/subscription";
import { mcpResponse } from "@/server/mcp/formatters";
import { type ToolContext } from "@/server/mcp/context";
import {
  getOptionalEnvValue,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";
import { fetchUserData } from "@/server/lib/dataforseo/appendix";
import { AppError } from "@/server/lib/errors";
import { looksLikeDataForSeoKey } from "@/shared/selfhost-checks";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { z } from "zod";

type DataforseoStatus =
  | { state: "ok"; balanceUsd: number | null }
  | { state: "not_configured" | "rejected" | "unreachable" };

/**
 * Self-hosted research runs on the operator's own DataForSEO account, so its
 * balance (in USD, from the free user_data endpoint) is what "credits" means
 * there. A missing or malformed key is reported as such instead of letting
 * the first paid call fail.
 */
async function getDataforseoStatus(): Promise<DataforseoStatus> {
  const key = await getOptionalEnvValue("DATAFORSEO_API_KEY");
  if (!key || !looksLikeDataForSeoKey(key)) return { state: "not_configured" };
  try {
    const data = await fetchUserData();
    return { state: "ok", balanceUsd: data?.money?.balance ?? null };
  } catch (error) {
    return error instanceof AppError && error.code === "DATAFORSEO_AUTH_FAILED"
      ? { state: "rejected" }
      : { state: "unreachable" };
  }
}

const DATAFORSEO_STATUS_TEXT: Record<DataforseoStatus["state"], string> = {
  ok: "configured",
  not_configured:
    "not configured — DATAFORSEO_API_KEY is missing or is not base64(login:password), so keyword, SERP, backlink, domain and local tools will fail. Site audits, Search Console and Analytics do not need it.",
  rejected:
    "DataForSEO rejected DATAFORSEO_API_KEY — check the login and password it encodes. Keyword, SERP, backlink, domain and local tools will fail.",
  unreachable: "could not be checked right now",
};

export const whoamiTool = {
  name: "whoami",
  config: {
    title: "Who am I",
    description:
      "Confirms the connected OpenSEO account, server mode, token scopes, and current credit balance when the user asks to check their account or connection. Initializes billing for new hosted accounts and returns creditsRemaining: null when the balance is unavailable. On a self-hosted server it reports instead whether DataForSEO is configured and that account's balance in USD (from DataForSEO's free account endpoint). Uses no credits.",
    inputSchema: {} as Record<string, never>,
    outputSchema: z.looseObject({
      userEmail: z.string(),
      scopes: z.array(z.string()),
      mode: z.enum(["hosted", "self-hosted"]),
      creditsRemaining: z.number().nullable(),
      dataforseo: z
        .looseObject({
          state: z.enum(["ok", "not_configured", "rejected", "unreachable"]),
          balanceUsd: z.number().nullable().optional(),
        })
        .optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: async (_args: Record<string, never>, context: ToolContext) => {
    const auth = context.auth;
    const isHosted = await isHostedServerAuthMode();
    let creditsRemaining: number | null = null;
    if (isHosted) {
      try {
        const customer = await getOrCreateOrganizationCustomer(auth);
        const { monthlyRemaining, topupRemaining } =
          await getUsageCreditsRemaining(customer.id);
        creditsRemaining = monthlyRemaining + topupRemaining;
      } catch {
        // Account identity is still available when billing is unavailable.
      }
    }
    const dataforseo = isHosted ? undefined : await getDataforseoStatus();
    const lines = [
      `Account: ${auth.userEmail}`,
      `Mode: ${isHosted ? "hosted" : "self-hosted"}`,
      `Scopes: ${auth.scopes.length > 0 ? auth.scopes.join(", ") : "none"}`,
    ];
    if (isHosted) {
      lines.push(
        `Credits remaining: ${creditsRemaining != null ? creditsRemaining.toLocaleString() : "unknown"}`,
      );
    }
    if (dataforseo) {
      lines.push(`DataForSEO: ${DATAFORSEO_STATUS_TEXT[dataforseo.state]}`);
      if (dataforseo.state === "ok" && dataforseo.balanceUsd != null) {
        lines.push(
          `DataForSEO balance: $${dataforseo.balanceUsd.toFixed(2)} (paid tools spend it directly; OpenSEO credits do not apply when self-hosted)`,
        );
      }
    }
    return mcpResponse({
      text: lines.join("\n"),
      meta: {
        creditsRemaining: creditsRemaining ?? undefined,
      },
      structuredContent: {
        userEmail: auth.userEmail,
        scopes: auth.scopes,
        mode: isHosted ? "hosted" : "self-hosted",
        creditsRemaining,
        dataforseo,
      },
    });
  },
};
