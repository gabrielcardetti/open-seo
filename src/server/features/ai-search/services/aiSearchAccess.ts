import { customerHasPaidPlan } from "@/server/billing/subscription";
import { AppError } from "@/server/lib/errors";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";

/**
 * AI Visibility is gated behind the paid plan in hosted mode because each call
 * fans out to several paid DataForSEO requests. Self-hosted deployments pay
 * DataForSEO directly and aren't gated. Shared by the app's server functions
 * and the MCP tools so both entry points enforce the same rule.
 */
export async function assertAiSearchAccess(organizationId: string) {
  if (!(await isHostedServerAuthMode())) return;
  if (await customerHasPaidPlan(organizationId)) return;
  throw new AppError(
    "PAYMENT_REQUIRED",
    "Upgrade to the paid plan to use AI Visibility",
  );
}
