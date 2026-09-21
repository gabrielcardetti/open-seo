/**
 * Data access for agent-readiness configs, scans and checks.
 * Provider-aware via `@/db`, written once for D1 and Postgres.
 */
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  agentReadinessChecks,
  agentReadinessConfigs,
  agentReadinessScans,
  projects,
} from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";
import type {
  AgentReadinessProfile,
  CheckResult,
} from "@/server/lib/agent-readiness/check-types";

async function getConfig(projectId: string) {
  const rows = await db
    .select()
    .from(agentReadinessConfigs)
    .where(eq(agentReadinessConfigs.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertConfig(input: {
  projectId: string;
  profile: AgentReadinessProfile;
  scheduleEnabled: boolean;
  nextRunAt: string | null;
}) {
  const updatedAt = new Date().toISOString();
  await db
    .insert(agentReadinessConfigs)
    .values({ ...input, updatedAt })
    .onConflictDoUpdate({
      target: agentReadinessConfigs.projectId,
      set: {
        profile: input.profile,
        scheduleEnabled: input.scheduleEnabled,
        nextRunAt: input.nextRunAt,
        updatedAt,
      },
    });
}

async function createScan(input: {
  id: string;
  projectId: string;
  origin: string;
  profile: AgentReadinessProfile;
  trigger: "manual" | "scheduled";
}) {
  await db.insert(agentReadinessScans).values({
    ...input,
    status: "running",
    startedAt: new Date().toISOString(),
  });
}

async function completeScan(input: {
  scanId: string;
  passed: number;
  applicable: number;
  cloudflareStatus: "ok" | "error" | "skipped";
  cloudflareLevel: number | null;
  cloudflareRaw: string | null;
  errorMessage: string | null;
  checks: Array<CheckResult & { engine: "openseo" | "cloudflare" }>;
}) {
  const rows = input.checks.map((check) => ({
    id: crypto.randomUUID(),
    scanId: input.scanId,
    engine: check.engine,
    checkId: check.checkId,
    category: check.category,
    status: check.status,
    message: check.message.slice(0, 1000),
    evidence: check.evidence?.slice(0, 1000) ?? null,
    fixUrl: check.fixUrl ?? null,
  }));
  await executeInBatches(rows, (tx, row) =>
    tx.insert(agentReadinessChecks).values(row),
  );
  await db
    .update(agentReadinessScans)
    .set({
      status: "completed",
      passed: input.passed,
      applicable: input.applicable,
      cloudflareStatus: input.cloudflareStatus,
      cloudflareLevel: input.cloudflareLevel,
      cloudflareRaw: input.cloudflareRaw,
      errorMessage: input.errorMessage,
      completedAt: new Date().toISOString(),
    })
    .where(eq(agentReadinessScans.id, input.scanId));
}

async function failScan(scanId: string, errorMessage: string) {
  await db
    .update(agentReadinessScans)
    .set({
      status: "failed",
      errorMessage: errorMessage.slice(0, 500),
      completedAt: new Date().toISOString(),
    })
    .where(eq(agentReadinessScans.id, scanId));
}

/** Most recent first. `startedAt` is app-written ISO text in both dialects. */
async function getScans(projectId: string, limit: number) {
  return db
    .select({
      id: agentReadinessScans.id,
      origin: agentReadinessScans.origin,
      profile: agentReadinessScans.profile,
      trigger: agentReadinessScans.trigger,
      status: agentReadinessScans.status,
      passed: agentReadinessScans.passed,
      applicable: agentReadinessScans.applicable,
      cloudflareStatus: agentReadinessScans.cloudflareStatus,
      cloudflareLevel: agentReadinessScans.cloudflareLevel,
      errorMessage: agentReadinessScans.errorMessage,
      startedAt: agentReadinessScans.startedAt,
      completedAt: agentReadinessScans.completedAt,
    })
    .from(agentReadinessScans)
    .where(eq(agentReadinessScans.projectId, projectId))
    .orderBy(desc(agentReadinessScans.startedAt))
    .limit(limit);
}

async function getChecksForScan(scanId: string) {
  return db
    .select()
    .from(agentReadinessChecks)
    .where(eq(agentReadinessChecks.scanId, scanId));
}

/**
 * A scan still running that started after `sinceIso`. Older "running" rows are
 * scans whose isolate died mid-run; counting them would block the project
 * forever.
 */
async function hasRecentRunningScan(
  projectId: string,
  sinceIso: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: agentReadinessScans.id })
    .from(agentReadinessScans)
    .where(
      and(
        eq(agentReadinessScans.projectId, projectId),
        eq(agentReadinessScans.status, "running"),
        gte(agentReadinessScans.startedAt, sinceIso),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Enabled configs whose daily scan is due, oldest first. */
async function getDueConfigs(nowIso: string, limit: number) {
  return db
    .select({
      projectId: agentReadinessConfigs.projectId,
      profile: agentReadinessConfigs.profile,
      nextRunAt: agentReadinessConfigs.nextRunAt,
      domain: projects.domain,
    })
    .from(agentReadinessConfigs)
    .innerJoin(projects, eq(agentReadinessConfigs.projectId, projects.id))
    .where(
      and(
        eq(agentReadinessConfigs.scheduleEnabled, true),
        lte(agentReadinessConfigs.nextRunAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(agentReadinessConfigs.nextRunAt))
    .limit(limit);
}

/**
 * Compare-and-set on `nextRunAt`: whichever cron tick moves it first owns the
 * run, so overlapping ticks never scan the same project twice.
 */
async function claimDueConfig(input: {
  projectId: string;
  observedNextRunAt: string;
  nextRunAt: string;
  lastSkipReason?: string | null;
}): Promise<boolean> {
  const claimed = await db
    .update(agentReadinessConfigs)
    .set({
      nextRunAt: input.nextRunAt,
      ...(input.lastSkipReason !== undefined && {
        lastSkipReason: input.lastSkipReason,
      }),
    })
    .where(
      and(
        eq(agentReadinessConfigs.projectId, input.projectId),
        eq(agentReadinessConfigs.scheduleEnabled, true),
        eq(agentReadinessConfigs.nextRunAt, input.observedNextRunAt),
      ),
    )
    .returning({ projectId: agentReadinessConfigs.projectId });
  return claimed.length > 0;
}

export const AgentReadinessRepository = {
  getConfig,
  upsertConfig,
  createScan,
  completeScan,
  failScan,
  getScans,
  getChecksForScan,
  hasRecentRunningScan,
  getDueConfigs,
  claimDueConfig,
} as const;
