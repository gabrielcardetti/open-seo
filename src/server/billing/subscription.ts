import { env } from "cloudflare:workers";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import {
  AUTUMN_MANAGED_ACCESS_FEATURE_ID,
  AUTUMN_PAID_PLAN_FEATURE_ID,
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
  applyBillingMarkupUsd,
  creditsForProviderUsd,
} from "@/shared/billing";
import type { CreditFeature } from "@/shared/billing-credit-features";
import { autumn, AUTUMN_TRACK_RETRY_OPTIONS } from "@/server/billing/autumn";
import { captureServerEvent } from "@/server/lib/posthog";
import { AppError } from "@/server/lib/errors";

export type BillingCustomerContext = Pick<
  EnsuredUserContext,
  "organizationId" | "userEmail" | "userId"
> & {
  projectId?: string;
};

// Existence is monotonic and the Autumn customer id is always the org id we
// pass, so once we've confirmed a customer exists we can skip the round trip
// and reuse the org id. Callers only need `.id` (they read balances via
// `check`), and a degraded Autumn API otherwise added seconds to every hot-path
// request that ensured the customer (incident 2026-07-06). Long TTL is safe:
// we only ever cache confirmed existence, never absence.
const CUSTOMER_ENSURED_TTL_SECONDS = 24 * 60 * 60;
const customerEnsuredKey = (organizationId: string) =>
  `autumn:customer-ensured:${organizationId}`;

export async function getOrCreateOrganizationCustomer(
  context: BillingCustomerContext,
): Promise<{ id: string }> {
  const cacheKey = customerEnsuredKey(context.organizationId);
  try {
    if (await env.KV.get(cacheKey)) {
      return { id: context.organizationId };
    }
  } catch (error) {
    console.warn("billing.customer-cache-read failed:", error);
  }

  const customer = await autumn.customers.getOrCreate({
    customerId: context.organizationId,
    email: context.userEmail,
  });

  if (!customer.id) {
    throw new AppError("INTERNAL_ERROR", "Failed to resolve billing customer");
  }

  try {
    await env.KV.put(cacheKey, "1", {
      expirationTtl: CUSTOMER_ENSURED_TTL_SECONDS,
    });
  } catch (error) {
    console.warn("billing.customer-cache-write failed:", error);
  }

  return { id: customer.id };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function customerHasPaidPlan(
  customerId: string,
  opts: { retryDenied?: boolean } = {},
) {
  const result = await autumn.check({
    customerId,
    featureId: AUTUMN_PAID_PLAN_FEATURE_ID,
  });
  if (result.allowed || !opts.retryDenied) return result.allowed;

  // Autumn sometimes returns degraded entitlement data in a successful
  // response (see the balance retry in getUsageCreditsRemaining). Where a
  // false negative does lasting damage — the scheduler would advance a paying
  // org's schedule and flag "plan_required" — callers opt into one re-check.
  // Interactive deny paths skip it to stay fast for genuinely free users.
  await sleep(300);
  const retry = await autumn.check({
    customerId,
    featureId: AUTUMN_PAID_PLAN_FEATURE_ID,
  });
  return retry.allowed;
}

export async function customerHasManagedAccess(customerId: string) {
  const result = await autumn.check({
    customerId,
    featureId: AUTUMN_MANAGED_ACCESS_FEATURE_ID,
  });

  return result.allowed;
}

// Remaining shared usage credits — the monthly `usage_credits` balance plus the
// rolled-over `topup_credits` balance. Both DataForSEO and LLM spend draw from
// these (the `seo_data_usage` and `llm_usage` features both map into them).
async function getUsageCreditsRemaining(customerId: string): Promise<{
  monthlyRemaining: number;
  topupRemaining: number;
}> {
  const [monthlyCheck, topupCheck] = await Promise.all([
    autumn.check({ customerId, featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID }),
    autumn.check({
      customerId,
      featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
    }),
  ]);

  // Autumn sometimes returns a successful response with no monthly balance
  // for a customer that holds the feature. Retry that read once because the
  // SDK's retry policy only covers failed HTTP requests.
  let monthlyBalance = monthlyCheck.balance;
  if (!monthlyBalance) {
    await sleep(300);
    const retry = await autumn.check({
      customerId,
      featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
    });
    monthlyBalance = retry.balance;
  }

  // Every hosted org holds the monthly feature (the free plan is the Autumn
  // default, attached at customer creation), so a check with no balance data
  // is a broken read, not an empty wallet. Throwing keeps it out of the
  // credit math — coercing it to 0 once locked a paying customer with ~9k
  // credits out of chat (2026-07-20). The topup balance genuinely doesn't
  // exist until a first top-up, so 0 is the honest reading there.
  if (!monthlyBalance) {
    // INTERNAL_ERROR, not UPSTREAM_UNAVAILABLE: this must stay reportable.
    throw new AppError(
      "INTERNAL_ERROR",
      `Autumn check returned no ${AUTUMN_SEO_DATA_BALANCE_FEATURE_ID} balance for customer ${customerId}`,
    );
  }

  return {
    monthlyRemaining: monthlyBalance.remaining,
    topupRemaining: topupCheck.balance?.remaining ?? 0,
  };
}

/**
 * Depletion check for the chat-agent gates. A /check reading ≤ 0 is not
 * trusted on its own: Autumn has served a stale balance transiently
 * (2026-07-20, minutes after a customer's free→paid upgrade), and a false
 * refusal locks the customer out of chat. When the check reads depleted,
 * confirm against the full customer object — a separate Autumn read path —
 * and refuse only when both agree. A disagreement means Autumn served
 * inconsistent balances: the turn proceeds on the confirmed reading and the
 * inconsistency is logged at error level so it lands in Workers error
 * tracking, not buried in analytics. Confirmed refusals emit a PostHog event (paywall
 * analytics — refusals used to be invisible everywhere).
 */
export async function checkUsageCreditsDepleted(
  customer: BillingCustomerContext,
): Promise<{ depleted: boolean; monthlyRemaining: number }> {
  const check = await getUsageCreditsRemaining(customer.organizationId);
  if (check.monthlyRemaining + check.topupRemaining > 0) {
    return { depleted: false, monthlyRemaining: check.monthlyRemaining };
  }

  // No try/catch: if this second read fails while the first said depleted,
  // the whole gate errors rather than guessing — the turn fails generically
  // and retryably instead of refusing with a possibly-false paywall.
  const full = await autumn.customers.getOrCreate({
    customerId: customer.organizationId,
    email: customer.userEmail,
  });
  const confirmed = {
    monthlyRemaining:
      full.balances[AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]?.remaining ?? 0,
    topupRemaining:
      full.balances[AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID]?.remaining ?? 0,
  };

  if (confirmed.monthlyRemaining + confirmed.topupRemaining > 0) {
    console.error(
      "billing.credits-gate disagreement: /check read depleted but the " +
        "customer object shows credits; proceeding on the customer reading",
      {
        organizationId: customer.organizationId,
        check,
        confirmed,
      },
    );
    return { depleted: false, monthlyRemaining: confirmed.monthlyRemaining };
  }

  await captureServerEvent({
    distinctId: customer.userId,
    event: "usage:credits_gate_refused",
    organizationId: customer.organizationId,
    properties: {
      project_id: customer.projectId,
      monthly_remaining: confirmed.monthlyRemaining,
      topup_remaining: confirmed.topupRemaining,
    },
  });
  return { depleted: true, monthlyRemaining: check.monthlyRemaining };
}

// A hold outlives the provider call it covers; an orphaned hold (isolate
// death between check and finalize) releases at this TTL with no deduction.
const HOLD_TTL_MS = 30 * 60_000;

type UsageCreditFeatureId =
  | typeof AUTUMN_SEO_DATA_BALANCE_FEATURE_ID
  | typeof AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID;

type UsageCreditHold = {
  lockId: string;
  featureId: UsageCreditFeatureId;
  estimatedCredits: number;
};

/**
 * Atomically holds `credits` on one balance feature. Autumn refuses the hold
 * (allowed: false) when the balance is short, so concurrent calls cannot all
 * pass on the same reading the way a plain balance check lets them.
 *
 * The SDK fails open on a failed request (timeout, 5xx) with `allowed: true,
 * balance: null`, including one Autumn actually processed; that is a broken
 * read, not a wallet, so retry it once and then fail closed. The retry reuses
 * the lockId: a 409 `lock_already_exists` means the first hold landed (a
 * refusal creates no lock), so the call proceeds on it instead of stranding a
 * second hold for HOLD_TTL_MS. The SDK's own 5xx retry is off
 * (AUTUMN_TRACK_RETRY_OPTIONS): it would replay a lock Autumn already took
 * and throw that 409 from the first attempt, where nothing catches it. An
 * absent feature reads `allowed: false, balance: null` and is a genuine
 * refusal.
 */
async function holdCredits(
  customerId: string,
  featureId: UsageCreditFeatureId,
  estimatedCredits: number,
  properties: Record<string, unknown>,
) {
  const lockId = `dfs_${customerId}_${crypto.randomUUID()}`;
  const hold: UsageCreditHold = { lockId, featureId, estimatedCredits };
  const attempt = () =>
    autumn.check(
      {
        customerId,
        featureId,
        requiredBalance: estimatedCredits,
        sendEvent: true,
        properties,
        lock: { lockId, enabled: true, expiresAt: Date.now() + HOLD_TTL_MS },
      },
      AUTUMN_TRACK_RETRY_OPTIONS,
    );

  let result = await attempt();
  if (result.allowed && !result.balance) {
    await sleep(300);
    try {
      result = await attempt();
    } catch (error) {
      if (!errorBodyIncludes(error, "lock_already_exists")) throw error;
      return { hold, allowed: true, balance: null };
    }
  }
  if (result.allowed && !result.balance) {
    // INTERNAL_ERROR, not UPSTREAM_UNAVAILABLE: this must stay reportable.
    throw new AppError(
      "INTERNAL_ERROR",
      `Autumn check returned no ${featureId} balance for customer ${customerId}`,
    );
  }
  return { hold, allowed: result.allowed, balance: result.balance };
}

/**
 * Reserves the estimated credits for one provider call before it is made:
 * monthly `usage_credits` first, else the whole estimate on `topup_credits`.
 * Throws INSUFFICIENT_CREDITS (and emits the refusal event) when neither
 * covers it. The caller must settle the returned hold with
 * `settleUsageCredits` once the call's real cost is known.
 */
export async function reserveUsageCredits(args: {
  customer: BillingCustomerContext;
  customerId: string;
  estimatedCredits: number;
  creditFeature?: CreditFeature;
}): Promise<UsageCreditHold> {
  const estimatedCredits = Math.max(1, args.estimatedCredits);
  const properties = {
    creditFeature: args.creditFeature,
    provider: "dataforseo",
    estimatedCredits,
  };

  const monthly = await holdCredits(
    args.customerId,
    AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
    estimatedCredits,
    properties,
  );
  if (monthly.allowed) return monthly.hold;

  const topup = await holdCredits(
    args.customerId,
    AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
    estimatedCredits,
    properties,
  );
  if (topup.allowed) return topup.hold;

  await captureServerEvent({
    distinctId: args.customer.userId,
    event: "usage:credits_gate_refused",
    organizationId: args.customer.organizationId,
    properties: {
      project_id: args.customer.projectId,
      reason: "estimate_exceeds_balance",
      source: "dataforseo",
      credit_feature: args.creditFeature,
      estimated_credits: estimatedCredits,
      monthly_remaining: monthly.balance?.remaining ?? 0,
      topup_remaining: topup.balance?.remaining ?? 0,
    },
  });
  throw new AppError("INSUFFICIENT_CREDITS");
}

// The SDK throws 4xx responses with the raw response body attached. Autumn
// answers a reused lockId with 409 `lock_already_exists`, and a finalize for
// a lock it no longer holds with a 400 whose message starts "Lock not found"
// (the code is the generic invalid_request).
function errorBodyIncludes(error: unknown, text: string) {
  return (
    error instanceof Error &&
    "body" in error &&
    typeof error.body === "string" &&
    error.body.includes(text)
  );
}

/**
 * Settles a hold on the provider's real cost: confirms the deduction at the
 * actual credits (Autumn deducts the override, above or below the hold, and
 * returns the rest) or releases the hold when nothing was billed. Never
 * throws: the customer already has the data, so a finalize that still fails
 * after one retry is logged with everything needed to reconcile it and the
 * hold expires at its TTL.
 */
export async function settleUsageCredits(args: {
  customer: BillingCustomerContext;
  hold: UsageCreditHold;
  /** Resolved from the billed path by the caller; unknown for an unbilled call. */
  creditFeature?: CreditFeature;
  /** Billed provider cost, or null when the call was not charged. */
  cost: { costUsd: number; path: string[] } | null;
}): Promise<void> {
  const { customer, hold, creditFeature, cost } = args;
  const actualCredits = cost ? creditsForProviderUsd(cost.costUsd) : 0;
  const totalCostUsd = cost ? applyBillingMarkupUsd(cost.costUsd) : 0;
  const paths = cost ? [cost.path.join("/")] : [];

  // No SDK-level 5xx retry (AUTUMN_TRACK_RETRY_OPTIONS): this loop owns
  // the retry so a "Lock not found" can only be seen on our second attempt.
  const finalize = () =>
    autumn.balances.finalize(
      {
        lockId: hold.lockId,
        ...(actualCredits > 0
          ? { action: "confirm", overrideValue: actualCredits }
          : { action: "release" }),
        properties: {
          creditFeature,
          provider: "dataforseo",
          paths,
          totalCostUsd,
          estimatedCredits: hold.estimatedCredits,
        },
      },
      AUTUMN_TRACK_RETRY_OPTIONS,
    );

  let landed = false;
  let lastError: unknown;
  for (const attempt of [1, 2]) {
    if (attempt === 2) await sleep(250);
    try {
      landed = (await finalize()).success;
    } catch (error) {
      lastError = error;
      if (errorBodyIncludes(error, "Lock not found")) {
        // On the retry this means the first attempt landed; on the first
        // attempt the hold has already expired and the deduction is lost.
        landed = attempt === 2;
        break;
      }
    }
    if (landed) break;
  }
  if (!landed) {
    console.error("[autumn] finalize failed", {
      organizationId: customer.organizationId,
      lockId: hold.lockId,
      held: hold.estimatedCredits,
      actual: actualCredits,
      error: lastError,
    });
    return;
  }
  if (actualCredits <= 0) return;

  const onMonthly = hold.featureId === AUTUMN_SEO_DATA_BALANCE_FEATURE_ID;
  await captureCreditsConsumed(customer, {
    credit_feature: creditFeature,
    monthly_credits: onMonthly ? actualCredits : 0,
    topup_credits: onMonthly ? 0 : actualCredits,
    total_credits: actualCredits,
    cost_usd: totalCostUsd,
    estimated_credits: hold.estimatedCredits,
    paths,
  });

  // The estimate is meant to be an upper bound; an undershoot means a price
  // constant in pricing.ts is stale and the spend bound has a hole.
  if (actualCredits > hold.estimatedCredits) {
    console.error("[billing] estimate undershoot", {
      paths,
      estimated: hold.estimatedCredits,
      actual: actualCredits,
    });
  }
}

function captureCreditsConsumed(
  customer: BillingCustomerContext,
  properties: Record<string, unknown>,
) {
  return captureServerEvent({
    distinctId: customer.userId,
    event: "usage:credits_consume",
    organizationId: customer.organizationId,
    properties: { project_id: customer.projectId, ...properties },
  });
}

/**
 * Deducts a USD provider cost from the org's shared usage-credit pool after
 * the fact: applies the platform markup, converts to credits, spends monthly
 * `usage_credits` first then `topup_credits`, and emits the
 * usage:credits_consume event. Only SAM's LLM spend uses this (token cost is
 * unknowable up front); DataForSEO calls reserve-then-settle instead. Pass
 * `monthlyRemaining` from the balance check that gated the call.
 */
export async function trackUsageCreditSpend(args: {
  customer: BillingCustomerContext;
  customerId: string;
  creditFeature: CreditFeature;
  costUsd: number;
  monthlyRemaining: number;
  properties?: Record<string, unknown>;
}): Promise<{ monthlyCredits: number; topupCredits: number }> {
  const totalCostUsd = applyBillingMarkupUsd(args.costUsd);
  const totalCostCredits = creditsForProviderUsd(args.costUsd);
  if (totalCostCredits <= 0) return { monthlyCredits: 0, topupCredits: 0 };

  // Clamp at 0: Autumn balances can read negative after an overdraft, and a
  // negative monthly reading here would inflate the topup deduction.
  const monthlyDeduct = Math.min(
    Math.max(args.monthlyRemaining, 0),
    totalCostCredits,
  );
  const topupDeduct = totalCostCredits - monthlyDeduct;

  const properties = {
    currency: "USD",
    creditFeature: args.creditFeature,
    totalCostUsd,
    totalCostCredits,
    ...args.properties,
  };

  if (monthlyDeduct > 0) {
    await autumn.track(
      {
        customerId: args.customerId,
        featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        value: monthlyDeduct,
        properties: {
          ...properties,
          balanceFeatureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
        },
      },
      AUTUMN_TRACK_RETRY_OPTIONS,
    );
  }

  if (topupDeduct > 0) {
    await autumn.track(
      {
        customerId: args.customerId,
        featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
        value: topupDeduct,
        properties: {
          ...properties,
          balanceFeatureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
        },
      },
      AUTUMN_TRACK_RETRY_OPTIONS,
    );
  }

  await captureCreditsConsumed(args.customer, {
    credit_feature: args.creditFeature,
    monthly_credits: monthlyDeduct,
    topup_credits: topupDeduct,
    total_credits: totalCostCredits,
    cost_usd: totalCostUsd,
  });
  return { monthlyCredits: monthlyDeduct, topupCredits: topupDeduct };
}
