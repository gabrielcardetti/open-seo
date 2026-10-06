/**
 * The per-upstream circuit breaker rows. Every write that changes who may
 * call is a compare-and-set, so concurrent cron ticks and requests (which
 * share no memory across Workers isolates) agree on one probe at a time.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { upstreamBreakers } from "@/db/schema";

type UpstreamBreakerRow = typeof upstreamBreakers.$inferSelect;

async function get(upstream: string): Promise<UpstreamBreakerRow | null> {
  const rows = await db
    .select()
    .from(upstreamBreakers)
    .where(eq(upstreamBreakers.upstream, upstream))
    .limit(1);
  return rows[0] ?? null;
}

async function listOpen(): Promise<UpstreamBreakerRow[]> {
  return db
    .select()
    .from(upstreamBreakers)
    .where(eq(upstreamBreakers.state, "open"));
}

/**
 * Open a closed (or never used) breaker. One that is already open is left
 * alone: callers that were in flight when it opened don't push the retry
 * further out; only a failed probe escalates the cooldown.
 */
async function open(input: {
  upstream: string;
  nowIso: string;
  nextProbeAt: string;
  error: string;
}): Promise<void> {
  const opened = {
    state: "open",
    consecutiveFailures: 1,
    openedAt: input.nowIso,
    nextProbeAt: input.nextProbeAt,
    lastError: input.error,
    updatedAt: input.nowIso,
  };
  await db
    .insert(upstreamBreakers)
    .values({ upstream: input.upstream, ...opened })
    .onConflictDoUpdate({
      target: upstreamBreakers.upstream,
      set: opened,
      setWhere: eq(upstreamBreakers.state, "closed"),
    });
}

/**
 * Compare-and-set on `nextProbeAt`: whichever caller moves it first (to the
 * end of its probe lease) owns the probe; everyone else keeps waiting.
 */
async function claimProbe(input: {
  upstream: string;
  observedNextProbeAt: string;
  leaseUntil: string;
}): Promise<boolean> {
  const claimed = await db
    .update(upstreamBreakers)
    .set({ nextProbeAt: input.leaseUntil })
    .where(
      and(
        eq(upstreamBreakers.upstream, input.upstream),
        eq(upstreamBreakers.state, "open"),
        eq(upstreamBreakers.nextProbeAt, input.observedNextProbeAt),
      ),
    )
    .returning({ upstream: upstreamBreakers.upstream });
  return claimed.length > 0;
}

/** The probe failed: stay open with a longer cooldown. Only lands while the
 *  caller still holds the probe lease it claimed. */
async function reopen(input: {
  upstream: string;
  leaseUntil: string;
  consecutiveFailures: number;
  nextProbeAt: string;
  error: string;
  nowIso: string;
}): Promise<void> {
  await db
    .update(upstreamBreakers)
    .set({
      consecutiveFailures: input.consecutiveFailures,
      nextProbeAt: input.nextProbeAt,
      lastError: input.error,
      updatedAt: input.nowIso,
    })
    .where(
      and(
        eq(upstreamBreakers.upstream, input.upstream),
        eq(upstreamBreakers.state, "open"),
        eq(upstreamBreakers.nextProbeAt, input.leaseUntil),
      ),
    );
}

async function close(upstream: string, nowIso: string): Promise<void> {
  await db
    .update(upstreamBreakers)
    .set({
      state: "closed",
      consecutiveFailures: 0,
      openedAt: null,
      nextProbeAt: null,
      lastError: null,
      updatedAt: nowIso,
    })
    .where(eq(upstreamBreakers.upstream, upstream));
}

export const UpstreamBreakerRepository = {
  get,
  listOpen,
  open,
  claimProbe,
  reopen,
  close,
} as const;
