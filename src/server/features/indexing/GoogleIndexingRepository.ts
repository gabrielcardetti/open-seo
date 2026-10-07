/**
 * The project's Google Indexing API connection. Written once for D1 and
 * Postgres; every read and write is keyed by the project.
 */
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { googleIndexingConnections, projects } from "@/db/schema";

export type GoogleIndexingConnection =
  typeof googleIndexingConnections.$inferSelect;
type ConnectionPatch = Partial<
  Omit<GoogleIndexingConnection, "projectId" | "createdAt" | "updatedAt">
>;

async function getByProjectId(
  projectId: string,
): Promise<GoogleIndexingConnection | null> {
  const rows = await db
    .select()
    .from(googleIndexingConnections)
    .where(eq(googleIndexingConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/** Saving always overwrites: a revoked key must be replaceable. */
async function upsert(
  projectId: string,
  input: Omit<ConnectionPatch, "status"> &
    Pick<
      GoogleIndexingConnection,
      "serviceAccountEncrypted" | "clientEmail" | "status"
    >,
) {
  const now = new Date().toISOString();
  await db
    .insert(googleIndexingConnections)
    .values({ projectId, ...input, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: googleIndexingConnections.projectId,
      set: { ...input, updatedAt: now },
    });
}

async function update(projectId: string, patch: ConnectionPatch) {
  await db
    .update(googleIndexingConnections)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(googleIndexingConnections.projectId, projectId));
}

async function deleteByProjectId(projectId: string) {
  await db
    .delete(googleIndexingConnections)
    .where(eq(googleIndexingConnections.projectId, projectId));
}

/** Connections whose daily check is due: never scheduled first, then oldest. */
async function getDue(nowIso: string, limit: number) {
  return (
    db
      .select({
        projectId: googleIndexingConnections.projectId,
        nextCheckAt: googleIndexingConnections.nextCheckAt,
      })
      .from(googleIndexingConnections)
      .innerJoin(projects, eq(googleIndexingConnections.projectId, projects.id))
      .where(
        and(
          or(
            isNull(googleIndexingConnections.nextCheckAt),
            lte(googleIndexingConnections.nextCheckAt, nowIso),
          ),
          isNull(projects.archivedAt),
        ),
      )
      // SQLite sorts NULL first and Postgres last, so the null test is spelled
      // out for both.
      .orderBy(
        sql`${googleIndexingConnections.nextCheckAt} is null desc`,
        asc(googleIndexingConnections.nextCheckAt),
      )
      .limit(limit)
  );
}

/**
 * Compare-and-set on `nextCheckAt`: whichever cron tick moves it first owns
 * the check, so overlapping ticks never check one project twice.
 */
async function claimCheck(input: {
  projectId: string;
  observed: string | null;
  next: string;
}): Promise<boolean> {
  const claimed = await db
    .update(googleIndexingConnections)
    .set({ nextCheckAt: input.next })
    .where(
      and(
        eq(googleIndexingConnections.projectId, input.projectId),
        input.observed === null
          ? isNull(googleIndexingConnections.nextCheckAt)
          : eq(googleIndexingConnections.nextCheckAt, input.observed),
      ),
    )
    .returning({ projectId: googleIndexingConnections.projectId });
  return claimed.length > 0;
}

export const GoogleIndexingRepository = {
  getByProjectId,
  upsert,
  update,
  deleteByProjectId,
  getDue,
  claimCheck,
} as const;
