import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { bingConnections, projects, user } from "@/db/schema";

export type BingConnection = typeof bingConnections.$inferSelect;

async function getByProjectId(
  projectId: string,
): Promise<BingConnection | null> {
  const rows = await db
    .select()
    .from(bingConnections)
    .where(eq(bingConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/** The connection plus the email of the member whose key reads it. */
async function getWithConnectorByProjectId(projectId: string) {
  const rows = await db
    .select({ connection: bingConnections, connectorEmail: user.email })
    .from(bingConnections)
    .leftJoin(user, eq(user.id, bingConnections.connectedByUserId))
    .where(eq(bingConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Point a project at a Bing site. Picking a site (again) starts a fresh sync
 * state: the next cron tick syncs it, and the previous site's sync status and
 * quota don't carry over. Snapshot rows are keyed by site, so history is kept.
 */
async function upsert(input: {
  projectId: string;
  organizationId: string;
  siteUrl: string;
  connectedByUserId: string;
  nextSyncAt: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const resetSyncState = {
    lastSyncedAt: null,
    lastSyncError: null,
    dailyQuotaRemaining: null,
    monthlyQuotaRemaining: null,
    quotaCheckedAt: null,
  };
  await db
    .insert(bingConnections)
    .values({
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: bingConnections.projectId,
      set: {
        organizationId: input.organizationId,
        siteUrl: input.siteUrl,
        connectedByUserId: input.connectedByUserId,
        nextSyncAt: input.nextSyncAt,
        ...resetSyncState,
        updatedAt: now,
      },
    });
}

async function deleteByProjectId(projectId: string): Promise<void> {
  await db
    .delete(bingConnections)
    .where(eq(bingConnections.projectId, projectId));
}

async function setSyncEnabled(input: {
  projectId: string;
  syncEnabled: boolean;
  nextSyncAt: string | null;
}): Promise<void> {
  await db
    .update(bingConnections)
    .set({
      syncEnabled: input.syncEnabled,
      nextSyncAt: input.nextSyncAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(bingConnections.projectId, input.projectId));
}

/** After a key is replaced, sync that member's projects on the next tick
 *  instead of waiting a day with the old key's errors on screen. */
async function scheduleSyncForConnector(
  userId: string,
  nextSyncAt: string,
): Promise<void> {
  await db
    .update(bingConnections)
    .set({ nextSyncAt })
    .where(
      and(
        eq(bingConnections.connectedByUserId, userId),
        eq(bingConnections.syncEnabled, true),
      ),
    );
}

async function recordSyncResult(input: {
  projectId: string;
  lastSyncedAt?: string;
  lastSyncError: string | null;
  quota?: { daily: number; monthly: number; checkedAt: string };
}): Promise<void> {
  await db
    .update(bingConnections)
    .set({
      ...(input.lastSyncedAt && { lastSyncedAt: input.lastSyncedAt }),
      lastSyncError: input.lastSyncError,
      ...(input.quota && {
        dailyQuotaRemaining: input.quota.daily,
        monthlyQuotaRemaining: input.quota.monthly,
        quotaCheckedAt: input.quota.checkedAt,
      }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(bingConnections.projectId, input.projectId));
}

async function setNextSyncAt(
  projectId: string,
  nextSyncAt: string,
): Promise<void> {
  await db
    .update(bingConnections)
    .set({ nextSyncAt })
    .where(eq(bingConnections.projectId, projectId));
}

async function getDue(nowIso: string, limit: number) {
  return db
    .select({
      projectId: bingConnections.projectId,
      nextSyncAt: bingConnections.nextSyncAt,
    })
    .from(bingConnections)
    .innerJoin(projects, eq(bingConnections.projectId, projects.id))
    .where(
      and(
        eq(bingConnections.syncEnabled, true),
        lte(bingConnections.nextSyncAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(bingConnections.nextSyncAt))
    .limit(limit);
}

/**
 * Compare-and-set on `nextSyncAt`: whichever cron tick moves it first owns the
 * sync, so overlapping ticks never sync the same project twice.
 */
async function claimDue(input: {
  projectId: string;
  observedNextSyncAt: string;
  nextSyncAt: string;
}): Promise<boolean> {
  const claimed = await db
    .update(bingConnections)
    .set({ nextSyncAt: input.nextSyncAt })
    .where(
      and(
        eq(bingConnections.projectId, input.projectId),
        eq(bingConnections.syncEnabled, true),
        eq(bingConnections.nextSyncAt, input.observedNextSyncAt),
      ),
    )
    .returning({ projectId: bingConnections.projectId });
  return claimed.length > 0;
}

export const BingConnectionRepository = {
  getByProjectId,
  getWithConnectorByProjectId,
  upsert,
  deleteByProjectId,
  setSyncEnabled,
  scheduleSyncForConnector,
  recordSyncResult,
  setNextSyncAt,
  getDue,
  claimDue,
};
