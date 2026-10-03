import { eq } from "drizzle-orm";
import { db } from "@/db";
import { umamiConnections, user } from "@/db/schema";
import type { UmamiMode } from "@/shared/umami";

export type UmamiConnection = typeof umamiConnections.$inferSelect;

type WebsiteFields = {
  websiteId: string | null;
  websiteName: string | null;
  websiteDomain: string | null;
  teamId: string | null;
};

async function getByProjectId(
  projectId: string,
): Promise<UmamiConnection | null> {
  const rows = await db
    .select()
    .from(umamiConnections)
    .where(eq(umamiConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/** The connection plus the email of the member who saved it. */
async function getWithConnectorByProjectId(projectId: string) {
  const rows = await db
    .select({ connection: umamiConnections, connectorEmail: user.email })
    .from(umamiConnections)
    .leftJoin(user, eq(user.id, umamiConnections.connectedByUserId))
    .where(eq(umamiConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/** Save the project's instance and credential. Saving clears the last error;
 *  the caller decides whether the chosen website carries over. */
async function upsert(
  input: {
    projectId: string;
    organizationId: string;
    mode: UmamiMode;
    baseUrl: string;
    credentialEncrypted: string;
    credentialHint: string;
    connectedByUserId: string;
  } & WebsiteFields,
): Promise<void> {
  const now = new Date().toISOString();
  const { projectId, ...fields } = input;
  await db
    .insert(umamiConnections)
    .values({
      id: crypto.randomUUID(),
      projectId,
      ...fields,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: umamiConnections.projectId,
      set: { ...fields, lastError: null, updatedAt: now },
    });
}

async function setWebsite(
  projectId: string,
  website: WebsiteFields,
): Promise<void> {
  await db
    .update(umamiConnections)
    .set({ ...website, lastError: null, updatedAt: new Date().toISOString() })
    .where(eq(umamiConnections.projectId, projectId));
}

async function setLastError(
  projectId: string,
  lastError: string,
): Promise<void> {
  await db
    .update(umamiConnections)
    .set({ lastError, updatedAt: new Date().toISOString() })
    .where(eq(umamiConnections.projectId, projectId));
}

async function deleteByProjectId(projectId: string): Promise<void> {
  await db
    .delete(umamiConnections)
    .where(eq(umamiConnections.projectId, projectId));
}

export const UmamiConnectionRepository = {
  getByProjectId,
  getWithConnectorByProjectId,
  upsert,
  setWebsite,
  setLastError,
  deleteByProjectId,
};
