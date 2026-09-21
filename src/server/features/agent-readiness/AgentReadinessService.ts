/**
 * Agent readiness: run a scan with both engines, store it, and read it back as
 * a per-check comparison plus history.
 *
 * The scan is ~25 small HTTP requests and one call to Cloudflare's scanner, so
 * it runs inline — no Workflow. The two engines run in parallel and fail
 * independently: Cloudflare being down leaves its column as an error, it does
 * not fail our scan.
 */
import { AppError } from "@/server/lib/errors";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import type {
  AgentReadinessProfile,
  CheckResult,
} from "@/server/lib/agent-readiness/check-types";
import { AgentReadinessRepository } from "./AgentReadinessRepository";

const DEFAULT_PROFILE: AgentReadinessProfile = "content";
const DAY_MS = 24 * 60 * 60 * 1000;
/** A "running" scan older than this died mid-run; it no longer blocks. */
const STALE_RUNNING_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 60;

async function originFor(domain: string | null): Promise<string> {
  if (!domain) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This project has no domain to scan. Set one in the project settings.",
    );
  }
  return new URL(await normalizeAndValidateStartUrl(domain)).origin;
}

async function runScan(input: {
  projectId: string;
  domain: string | null;
  trigger: "manual" | "scheduled";
}): Promise<string> {
  const origin = await originFor(input.domain);
  const config = await AgentReadinessRepository.getConfig(input.projectId);
  const profile = config?.profile ?? DEFAULT_PROFILE;

  const since = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  if (
    await AgentReadinessRepository.hasRecentRunningScan(input.projectId, since)
  ) {
    throw new AppError(
      "CONFLICT",
      "A scan for this project is already running.",
    );
  }

  const scanId = crypto.randomUUID();
  await AgentReadinessRepository.createScan({
    id: scanId,
    projectId: input.projectId,
    origin,
    profile,
    trigger: input.trigger,
  });

  try {
    // Loaded lazily: the engines stay out of every other request's heap.
    const [
      { runAgentReadinessChecks, summarizeChecks },
      { createProbe },
      { scanWithCloudflare },
    ] = await Promise.all([
      import("@/server/lib/agent-readiness/checks"),
      import("@/server/lib/agent-readiness/probe"),
      import("@/server/lib/agent-readiness/cloudflare"),
    ]);

    const [ours, cloudflare] = await Promise.allSettled([
      runAgentReadinessChecks({ origin, profile, probe: createProbe() }),
      scanWithCloudflare({ url: `${origin}/`, profile }),
    ]);

    // Our own engine is the scan: without it there is nothing to record.
    if (ours.status === "rejected") throw ours.reason;

    const summary = summarizeChecks(ours.value);
    const checks: Array<CheckResult & { engine: "openseo" | "cloudflare" }> = [
      ...ours.value.map((check) => ({ ...check, engine: "openseo" as const })),
      ...(cloudflare.status === "fulfilled"
        ? cloudflare.value.checks.map((check) => ({
            ...check,
            engine: "cloudflare" as const,
          }))
        : []),
    ];

    await AgentReadinessRepository.completeScan({
      scanId,
      passed: summary.passed,
      applicable: summary.applicable,
      cloudflareStatus: cloudflare.status === "fulfilled" ? "ok" : "error",
      cloudflareLevel:
        cloudflare.status === "fulfilled" ? cloudflare.value.level : null,
      cloudflareRaw:
        cloudflare.status === "fulfilled" ? cloudflare.value.raw : null,
      errorMessage:
        cloudflare.status === "rejected"
          ? `Cloudflare scanner: ${cloudflare.reason instanceof Error ? cloudflare.reason.message : String(cloudflare.reason)}`
          : null,
      checks,
    });
    return scanId;
  } catch (error) {
    await AgentReadinessRepository.failScan(
      scanId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

interface ComparedCheck {
  checkId: string;
  category: string;
  openseo: CheckView | null;
  cloudflare: CheckView | null;
  /**
   * Whether the engines agree, when both decided. Null when either did not run
   * the check or did not reach a pass/fail verdict on it.
   */
  agree: boolean | null;
}

interface CheckView {
  status: string;
  message: string;
  evidence: string | null;
  fixUrl: string | null;
}

const DECIDED = new Set(["pass", "fail"]);

/** Pair both engines' results by check id. */
function compare(
  rows: Awaited<ReturnType<typeof AgentReadinessRepository.getChecksForScan>>,
): ComparedCheck[] {
  const byId = new Map<string, ComparedCheck>();
  for (const row of rows) {
    const entry = byId.get(row.checkId) ?? {
      checkId: row.checkId,
      category: row.category,
      openseo: null,
      cloudflare: null,
      agree: null,
    };
    entry[row.engine] = {
      status: row.status,
      message: row.message,
      evidence: row.evidence,
      fixUrl: row.fixUrl,
    };
    byId.set(row.checkId, entry);
  }
  for (const entry of byId.values()) {
    const a = entry.openseo?.status;
    const b = entry.cloudflare?.status;
    entry.agree = a && b && DECIDED.has(a) && DECIDED.has(b) ? a === b : null;
  }
  return Array.from(byId.values());
}

async function getOverview(projectId: string) {
  const [config, scans] = await Promise.all([
    AgentReadinessRepository.getConfig(projectId),
    AgentReadinessRepository.getScans(projectId, HISTORY_LIMIT),
  ]);
  const latest =
    scans.find((scan) => scan.status !== "running") ?? scans[0] ?? null;
  const checks = latest
    ? compare(await AgentReadinessRepository.getChecksForScan(latest.id))
    : [];
  return {
    config: {
      profile: config?.profile ?? DEFAULT_PROFILE,
      scheduleEnabled: config?.scheduleEnabled ?? false,
      nextRunAt: config?.nextRunAt ?? null,
    },
    latest,
    checks,
    history: scans,
  };
}

async function updateConfig(input: {
  projectId: string;
  profile: AgentReadinessProfile;
  scheduleEnabled: boolean;
}) {
  const existing = await AgentReadinessRepository.getConfig(input.projectId);
  // Turning the schedule on runs the first scan on the next cron tick; keeping
  // it on leaves the existing cadence alone.
  const nextRunAt = input.scheduleEnabled
    ? existing?.scheduleEnabled && existing.nextRunAt
      ? existing.nextRunAt
      : new Date().toISOString()
    : null;
  await AgentReadinessRepository.upsertConfig({ ...input, nextRunAt });
}

/** Cap per cron tick, and a deadline, so a backlog drains over several ticks. */
const SCANS_PER_TICK = 5;
const TICK_DEADLINE_MS = 3 * 60 * 1000;

/**
 * Daily scans, driven by the five-minute cron. Each due project is claimed with a
 * compare-and-set that also advances it a day, so overlapping ticks never scan
 * the same project twice and a failing project is retried tomorrow, not every
 * five minutes.
 */
async function runScheduledScans(): Promise<{
  ran: number;
  skipped: number;
  failed: number;
}> {
  const startedAt = Date.now();
  const now = new Date(startedAt).toISOString();
  const due = await AgentReadinessRepository.getDueConfigs(now, SCANS_PER_TICK);
  const tally = { ran: 0, skipped: 0, failed: 0 };

  for (const config of due) {
    if (Date.now() - startedAt > TICK_DEADLINE_MS) break;
    if (!config.nextRunAt) continue;
    const claimed = await AgentReadinessRepository.claimDueConfig({
      projectId: config.projectId,
      observedNextRunAt: config.nextRunAt,
      nextRunAt: new Date(startedAt + DAY_MS).toISOString(),
      lastSkipReason: config.domain ? null : "no_domain",
    });
    if (!claimed) continue;
    if (!config.domain) {
      tally.skipped += 1;
      continue;
    }
    try {
      await runScan({
        projectId: config.projectId,
        domain: config.domain,
        trigger: "scheduled",
      });
      tally.ran += 1;
    } catch (error) {
      tally.failed += 1;
      console.error("Scheduled agent-readiness scan failed", {
        projectId: config.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (due.length > 0) {
    console.log("Scheduled agent-readiness tick", {
      due: due.length,
      ...tally,
    });
  }
  return tally;
}

export const AgentReadinessService = {
  runScan,
  getOverview,
  updateConfig,
  runScheduledScans,
} as const;
