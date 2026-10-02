import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bingConnections } from "@/db/schema";

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

export const BingConnectionRepository = {
  getByProjectId,
};
