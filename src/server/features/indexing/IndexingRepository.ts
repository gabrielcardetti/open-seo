/**
 * Indexing settings, the sitemap URL inventory, and the cached Bing URL
 * submission quota. Written once for D1 and Postgres.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  bingConnections,
  indexingSettings,
  projects,
  sitemapUrls,
} from "@/db/schema";

export type IndexingSettings = typeof indexingSettings.$inferSelect;
type SettingsPatch = Partial<
  Omit<IndexingSettings, "projectId" | "createdAt" | "updatedAt">
>;
type SitemapUrlRow = typeof sitemapUrls.$inferInsert;

// D1 binds at most 100 parameters per statement.
const SITEMAP_ROWS_PER_INSERT = 16; // 6 columns
const URLS_PER_IN_CLAUSE = 90;

async function getSettings(projectId: string) {
  const rows = await db
    .select()
    .from(indexingSettings)
    .where(eq(indexingSettings.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertSettings(projectId: string, patch: SettingsPatch) {
  const updatedAt = new Date().toISOString();
  await db
    .insert(indexingSettings)
    .values({ projectId, ...patch, createdAt: updatedAt, updatedAt })
    .onConflictDoUpdate({
      target: indexingSettings.projectId,
      set: { ...patch, updatedAt },
    });
}

/**
 * Create the project's settings row with defaults if it has none, so the
 * daily sitemap watch picks it up. Never changes an existing row.
 */
async function ensureSettings(projectId: string) {
  const now = new Date().toISOString();
  await db
    .insert(indexingSettings)
    .values({ projectId, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
}

/**
 * Store a key only when the project has none: a published key file must keep
 * matching, so a second "generate" (two tabs, a retry) never replaces it.
 */
async function setKeyIfAbsent(projectId: string, key: string) {
  const updatedAt = new Date().toISOString();
  await db
    .insert(indexingSettings)
    .values({
      projectId,
      indexnowKey: key,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: indexingSettings.projectId,
      set: { indexnowKey: key, indexnowVerifiedAt: null, updatedAt },
      setWhere: isNull(indexingSettings.indexnowKey),
    });
}

async function updateBingQuota(
  projectId: string,
  quota: { daily: number; monthly: number },
) {
  await db
    .update(bingConnections)
    .set({
      dailyQuotaRemaining: quota.daily,
      monthlyQuotaRemaining: quota.monthly,
      quotaCheckedAt: new Date().toISOString(),
    })
    .where(eq(bingConnections.projectId, projectId));
}

/** Projects whose daily sitemap check is due: never checked, then oldest. */
async function getDueSitemapChecks(nowIso: string, limit: number) {
  return (
    db
      .select({
        projectId: indexingSettings.projectId,
        nextSitemapCheckAt: indexingSettings.nextSitemapCheckAt,
        domain: projects.domain,
      })
      .from(indexingSettings)
      .innerJoin(projects, eq(indexingSettings.projectId, projects.id))
      .where(
        and(
          eq(indexingSettings.autoSubmitEnabled, true),
          or(
            isNull(indexingSettings.nextSitemapCheckAt),
            lte(indexingSettings.nextSitemapCheckAt, nowIso),
          ),
          isNull(projects.archivedAt),
        ),
      )
      // Never-checked projects first. SQLite sorts NULL first and Postgres
      // last, so the null test is spelled out for both.
      .orderBy(
        sql`${indexingSettings.nextSitemapCheckAt} is null desc`,
        asc(indexingSettings.nextSitemapCheckAt),
      )
      .limit(limit)
  );
}

/**
 * Compare-and-set on `nextSitemapCheckAt`: whichever cron tick moves it first
 * owns the check, so overlapping ticks never check one project twice.
 */
async function claimSitemapCheck(input: {
  projectId: string;
  observed: string | null;
  next: string;
}): Promise<boolean> {
  const claimed = await db
    .update(indexingSettings)
    .set({ nextSitemapCheckAt: input.next })
    .where(
      and(
        eq(indexingSettings.projectId, input.projectId),
        eq(indexingSettings.autoSubmitEnabled, true),
        input.observed === null
          ? isNull(indexingSettings.nextSitemapCheckAt)
          : eq(indexingSettings.nextSitemapCheckAt, input.observed),
      ),
    )
    .returning({ projectId: indexingSettings.projectId });
  return claimed.length > 0;
}

async function recordSitemapCheck(projectId: string, error: string | null) {
  await upsertSettings(projectId, {
    lastSitemapCheckAt: new Date().toISOString(),
    lastSitemapError: error?.slice(0, 500) ?? null,
  });
}

async function listSitemapUrls(projectId: string) {
  return db
    .select({
      url: sitemapUrls.url,
      lastmod: sitemapUrls.lastmod,
      removedAt: sitemapUrls.removedAt,
    })
    .from(sitemapUrls)
    .where(eq(sitemapUrls.projectId, projectId));
}

/**
 * Apply one sitemap check to the inventory: add new URLs, store newer
 * lastmods and reappearances, mark the URLs no longer listed as removed, then
 * stamp every still-listed URL as seen now.
 */
async function applySitemapInventory(input: {
  projectId: string;
  nowIso: string;
  inserted: Array<{ url: string; lastmod: string | null }>;
  updated: Array<{ url: string; lastmod: string | null }>;
  removed: string[];
}) {
  const { projectId, nowIso } = input;
  const rows: SitemapUrlRow[] = input.inserted.map((entry) => ({
    projectId,
    url: entry.url,
    lastmod: entry.lastmod,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
  }));
  await executeInBatches(chunk(rows, SITEMAP_ROWS_PER_INSERT), (tx, batch) =>
    tx.insert(sitemapUrls).values(batch).onConflictDoNothing(),
  );
  await executeInBatches(input.updated, (tx, entry) =>
    tx
      .update(sitemapUrls)
      .set({ lastmod: entry.lastmod, removedAt: null })
      .where(
        and(
          eq(sitemapUrls.projectId, projectId),
          eq(sitemapUrls.url, entry.url),
        ),
      ),
  );
  await executeInBatches(chunk(input.removed, URLS_PER_IN_CLAUSE), (tx, urls) =>
    tx
      .update(sitemapUrls)
      .set({ removedAt: nowIso })
      .where(
        and(
          eq(sitemapUrls.projectId, projectId),
          inArray(sitemapUrls.url, urls),
        ),
      ),
  );
  await db
    .update(sitemapUrls)
    .set({ lastSeenAt: nowIso })
    .where(
      and(eq(sitemapUrls.projectId, projectId), isNull(sitemapUrls.removedAt)),
    );
}

export const IndexingRepository = {
  ensureSettings,
  getSettings,
  upsertSettings,
  setKeyIfAbsent,
  updateBingQuota,
  getDueSitemapChecks,
  claimSitemapCheck,
  recordSitemapCheck,
  listSitemapUrls,
  applySitemapInventory,
} as const;
