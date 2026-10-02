import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bingApiKeys } from "@/db/schema";

export type BingApiKeyRow = typeof bingApiKeys.$inferSelect;

async function getByUserId(userId: string): Promise<BingApiKeyRow | null> {
  const rows = await db
    .select()
    .from(bingApiKeys)
    .where(eq(bingApiKeys.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export const BingApiKeyRepository = {
  getByUserId,
};
