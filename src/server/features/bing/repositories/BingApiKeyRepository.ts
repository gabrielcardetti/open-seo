import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bingApiKeys } from "@/db/schema";

type BingApiKeyRow = typeof bingApiKeys.$inferSelect;

async function getByUserId(userId: string): Promise<BingApiKeyRow | null> {
  const rows = await db
    .select()
    .from(bingApiKeys)
    .where(eq(bingApiKeys.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Saving always overwrites: a revoked key must be replaceable by a new one. */
async function upsert(input: {
  userId: string;
  apiKeyEncrypted: string;
  keyHint: string;
  verifiedAt: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(bingApiKeys)
    .values({ ...input, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: bingApiKeys.userId,
      set: {
        apiKeyEncrypted: input.apiKeyEncrypted,
        keyHint: input.keyHint,
        verifiedAt: input.verifiedAt,
        updatedAt: now,
      },
    });
}

async function deleteByUserId(userId: string): Promise<void> {
  await db.delete(bingApiKeys).where(eq(bingApiKeys.userId, userId));
}

export const BingApiKeyRepository = {
  getByUserId,
  upsert,
  deleteByUserId,
};
