/**
 * A circuit breaker per upstream (Bing's Webmaster API, IndexNow), persisted
 * so every Workers isolate sees it. A transport failure (the relay or the
 * network path is down, not the engine answering) opens it; while open,
 * callers short-circuit without touching the network. Once the cooldown
 * passes, the next real call goes out as the probe: any answer from the
 * engine closes the breaker, another transport failure re-opens it with a
 * longer cooldown.
 */
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { UpstreamBreakerRepository } from "./UpstreamBreakerRepository";

const UPSTREAMS = ["bing_api", "indexnow"] as const;
export type Upstream = (typeof UPSTREAMS)[number];

const MINUTE_MS = 60 * 1000;
/** Cooldown after the 1st, 2nd and 3rd-or-later consecutive failure. */
const COOLDOWNS_MS = [15 * MINUTE_MS, 60 * MINUTE_MS, 6 * 60 * MINUTE_MS];
/** How long a claimed probe holds off other callers. Longer than a probe
 *  call with its retries, short enough that a probe lost to a crashed
 *  isolate doesn't stall the breaker. */
const PROBE_LEASE_MS = 2 * MINUTE_MS;

const RELAY_ENV: Record<Upstream, string> = {
  bing_api: "BING_API_BASE_URL",
  indexnow: "INDEXNOW_API_BASE_URL",
};

export type UpstreamOutage = {
  upstream: Upstream;
  since: string;
  retryAt: string;
  lastError: string | null;
  /** One sentence for logs, the UI and agents. */
  message: string;
};

/**
 * Statuses that come from what sits between OpenSEO and the engine, not from
 * the engine: gateway errors (502/503/504) and Cloudflare's 52x origin errors
 * (530 is a Cloudflare Tunnel with no connector). An engine's own 503 can't be
 * told apart from a gateway's, and both mean "stop calling for a while".
 */
export function isTransportStatus(status: number): boolean {
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (status >= 520 && status <= 530)
  );
}

const iso = (ms: number) => new Date(ms).toISOString();

function cooldownMs(consecutiveFailures: number): number {
  return COOLDOWNS_MS[Math.min(consecutiveFailures, COOLDOWNS_MS.length) - 1];
}

async function describe(
  upstream: Upstream,
  since: string,
  retryAt: string,
  lastError: string | null,
): Promise<UpstreamOutage> {
  const viaRelay = Boolean(await getOptionalEnvValue(RELAY_ENV[upstream]));
  const name =
    upstream === "bing_api"
      ? viaRelay
        ? "The Bing relay"
        : "Bing Webmaster Tools"
      : viaRelay
        ? "The IndexNow relay"
        : "IndexNow";
  return {
    upstream,
    since,
    retryAt,
    lastError,
    message: `${name} is unreachable since ${since}${lastError ? ` (${lastError})` : ""}; retrying at ${retryAt}.`,
  };
}

function isUpstream(value: string): value is Upstream {
  return (UPSTREAMS as readonly string[]).includes(value);
}

async function toOutage(row: {
  upstream: string;
  state: string;
  openedAt: string | null;
  nextProbeAt: string | null;
  lastError: string | null;
}): Promise<UpstreamOutage | null> {
  if (row.state !== "open" || !isUpstream(row.upstream)) return null;
  if (!row.openedAt || !row.nextProbeAt) return null;
  return describe(row.upstream, row.openedAt, row.nextProbeAt, row.lastError);
}

/** The open breakers, for status displays. */
async function listOutages(): Promise<UpstreamOutage[]> {
  const rows = await UpstreamBreakerRepository.listOpen();
  const outages = await Promise.all(rows.map(toOutage));
  return outages.filter((outage) => outage !== null);
}

async function getOutage(upstream: Upstream): Promise<UpstreamOutage | null> {
  const row = await UpstreamBreakerRepository.get(upstream);
  return row ? toOutage(row) : null;
}

/**
 * Guards a run of calls to one upstream: one Bing client (a sync, a
 * request) or one IndexNow POST. The breaker is read on the first call only;
 * after a transport failure every later call of the run short-circuits too.
 */
export function createUpstreamGate(upstream: Upstream) {
  let checked = false;
  let probe: { leaseUntil: string; failures: number } | null = null;
  let outage: UpstreamOutage | null = null;

  return {
    /** The outage when the call must not go out; null when it may. */
    async admit(): Promise<UpstreamOutage | null> {
      if (outage || checked) return outage;
      checked = true;
      const row = await UpstreamBreakerRepository.get(upstream);
      if (!row || row.state !== "open") return null;
      const nowMs = Date.now();
      if (row.nextProbeAt && Date.parse(row.nextProbeAt) <= nowMs) {
        const leaseUntil = iso(nowMs + PROBE_LEASE_MS);
        const claimed = await UpstreamBreakerRepository.claimProbe({
          upstream,
          observedNextProbeAt: row.nextProbeAt,
          leaseUntil,
        });
        if (claimed) {
          probe = { leaseUntil, failures: row.consecutiveFailures };
          return null;
        }
        // Another caller is probing (or just settled the probe).
        outage = await getOutage(upstream);
        return outage;
      }
      outage = await toOutage(row);
      return outage;
    },

    /**
     * An admitted call failed in transport (`transportError` is a short
     * reason such as "HTTP 530"): open the breaker, or re-open it with a
     * longer cooldown when this call was the probe. Returns the outage.
     */
    async report(transportError: string): Promise<UpstreamOutage> {
      const nowMs = Date.now();
      let nextProbeAt: string;
      if (probe) {
        const failures = probe.failures + 1;
        nextProbeAt = iso(nowMs + cooldownMs(failures));
        await UpstreamBreakerRepository.reopen({
          upstream,
          leaseUntil: probe.leaseUntil,
          consecutiveFailures: failures,
          nextProbeAt,
          error: transportError,
          nowIso: iso(nowMs),
        });
        probe = null;
      } else {
        nextProbeAt = iso(nowMs + cooldownMs(1));
        await UpstreamBreakerRepository.open({
          upstream,
          nowIso: iso(nowMs),
          nextProbeAt,
          error: transportError,
        });
      }
      outage =
        (await getOutage(upstream)) ??
        (await describe(upstream, iso(nowMs), nextProbeAt, transportError));
      return outage;
    },

    /** The engine answered (whatever it said): close the breaker if this
     *  call was its probe. */
    async reachable(): Promise<void> {
      if (!probe) return;
      probe = null;
      await UpstreamBreakerRepository.close(upstream, iso(Date.now()));
    },
  };
}

export const UpstreamBreaker = {
  listOutages,
  getOutage,
} as const;
