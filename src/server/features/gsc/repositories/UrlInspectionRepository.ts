/**
 * The indexing monitor's persistence: per-project scheduling state, each
 * URL's latest URL Inspection result, and the history of its changes.
 * Written once for D1 and Postgres.
 */
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  gscConnections,
  projects,
  urlInspectionChanges,
  urlInspectionMonitors,
  urlInspections,
} from "@/db/schema";

export type UrlInspectionRow = typeof urlInspections.$inferSelect;
type UrlInspectionChange = typeof urlInspectionChanges.$inferInsert;
/** What one inspection writes; monitoring flags and firstSeenAt stay. */
export type LatestInspection = Omit<
  UrlInspectionRow,
  "projectId" | "url" | "inSitemap" | "sitemapUrl" | "firstSeenAt"
>;
type MonitorPatch = Partial<
  Pick<
    typeof urlInspectionMonitors.$inferInsert,
    "nextRunAt" | "urlsRefreshedAt" | "lastRunAt" | "lastError"
  >
>;

/** The verdict Google gives a URL that is on Google. */
export const INDEXED_VERDICT = "PASS";

// D1 binds at most 100 parameters per statement.
const ROWS_PER_INSERT = 16; // 5 columns
const URLS_PER_IN_CLAUSE = 90;

const projectScope = (projectId: string) =>
  eq(urlInspections.projectId, projectId);

/**
 * Projects with a Search Console property whose monitor run is due: never
 * run first, then the oldest. Archived projects are skipped.
 */
async function getDueMonitors(nowIso: string, limit: number) {
  return (
    db
      .select({
        projectId: gscConnections.projectId,
        nextRunAt: urlInspectionMonitors.nextRunAt,
      })
      .from(gscConnections)
      .innerJoin(projects, eq(gscConnections.projectId, projects.id))
      .leftJoin(
        urlInspectionMonitors,
        eq(urlInspectionMonitors.projectId, gscConnections.projectId),
      )
      .where(
        and(
          isNull(projects.archivedAt),
          or(
            isNull(urlInspectionMonitors.nextRunAt),
            lte(urlInspectionMonitors.nextRunAt, nowIso),
          ),
        ),
      )
      // SQLite sorts NULL first and Postgres last, so spell it out for both.
      .orderBy(
        sql`${urlInspectionMonitors.nextRunAt} is null desc`,
        asc(urlInspectionMonitors.nextRunAt),
      )
      .limit(limit)
  );
}

async function ensureMonitor(projectId: string, nowIso: string) {
  await db
    .insert(urlInspectionMonitors)
    .values({ projectId, createdAt: nowIso, updatedAt: nowIso })
    .onConflictDoNothing();
}

/**
 * Compare-and-set on `nextRunAt`: whichever cron tick moves it first owns
 * the run, so overlapping ticks never run one project twice.
 */
async function claimRun(input: {
  projectId: string;
  observed: string | null;
  next: string;
}): Promise<boolean> {
  const claimed = await db
    .update(urlInspectionMonitors)
    .set({ nextRunAt: input.next })
    .where(
      and(
        eq(urlInspectionMonitors.projectId, input.projectId),
        input.observed === null
          ? isNull(urlInspectionMonitors.nextRunAt)
          : eq(urlInspectionMonitors.nextRunAt, input.observed),
      ),
    )
    .returning({ projectId: urlInspectionMonitors.projectId });
  return claimed.length > 0;
}

async function getMonitor(projectId: string) {
  const [row] = await db
    .select()
    .from(urlInspectionMonitors)
    .where(eq(urlInspectionMonitors.projectId, projectId))
    .limit(1);
  return row ?? null;
}

async function updateMonitor(
  projectId: string,
  patch: MonitorPatch,
  nowIso: string,
) {
  await db
    .update(urlInspectionMonitors)
    .set({ ...patch, updatedAt: nowIso })
    .where(eq(urlInspectionMonitors.projectId, projectId));
}

/** Count `inspections` URL Inspection calls against the UTC day `day`. */
async function addInspections(
  projectId: string,
  inspections: number,
  day: string,
  nowIso: string,
) {
  if (inspections === 0) return;
  await ensureMonitor(projectId, nowIso);
  const used = urlInspectionMonitors.inspectionsToday;
  await db
    .update(urlInspectionMonitors)
    .set({
      inspectionsToday: sql`case when ${urlInspectionMonitors.budgetDay} = ${day} then ${used} + cast(${inspections} as integer) else cast(${inspections} as integer) end`,
      budgetDay: day,
      updatedAt: nowIso,
    })
    .where(eq(urlInspectionMonitors.projectId, projectId));
}

/**
 * Mark the URLs the sitemaps list now as monitored (with the sitemap that
 * listed each), and, when the read was complete, the rest as no longer
 * monitored. Rows are kept either way, so history survives a URL leaving
 * and coming back.
 */
async function syncSitemapUrls(input: {
  projectId: string;
  entries: Array<{ url: string; sitemap: string }>;
  removeMissing: boolean;
  nowIso: string;
}) {
  const { projectId, nowIso } = input;
  const existing = await db
    .select({
      url: urlInspections.url,
      inSitemap: urlInspections.inSitemap,
      sitemapUrl: urlInspections.sitemapUrl,
    })
    .from(urlInspections)
    .where(projectScope(projectId));
  const byUrl = new Map(existing.map((row) => [row.url, row]));
  const listed = new Set(input.entries.map((entry) => entry.url));

  const inserted = input.entries.filter((entry) => !byUrl.has(entry.url));
  await executeInBatches(chunk(inserted, ROWS_PER_INSERT), (tx, batch) =>
    tx
      .insert(urlInspections)
      .values(
        batch.map((entry) => ({
          projectId,
          url: entry.url,
          inSitemap: true,
          sitemapUrl: entry.sitemap,
          firstSeenAt: nowIso,
        })),
      )
      .onConflictDoNothing(),
  );

  const updated = input.entries.filter((entry) => {
    const row = byUrl.get(entry.url);
    return row && (!row.inSitemap || row.sitemapUrl !== entry.sitemap);
  });
  await executeInBatches(updated, (tx, entry) =>
    tx
      .update(urlInspections)
      .set({ inSitemap: true, sitemapUrl: entry.sitemap })
      .where(and(projectScope(projectId), eq(urlInspections.url, entry.url))),
  );

  if (!input.removeMissing) return;
  const removed = existing
    .filter((row) => row.inSitemap && !listed.has(row.url))
    .map((row) => row.url);
  await executeInBatches(chunk(removed, URLS_PER_IN_CLAUSE), (tx, urls) =>
    tx
      .update(urlInspections)
      .set({ inSitemap: false })
      .where(and(projectScope(projectId), inArray(urlInspections.url, urls))),
  );
}

/**
 * Up to `limit` monitored URLs to inspect, in priority order: never
 * inspected, then not indexed and last inspected before `notIndexedBefore`,
 * then indexed and last inspected before `indexedBefore`.
 */
async function pickDue(input: {
  projectId: string;
  limit: number;
  notIndexedBefore: string;
  indexedBefore: string;
}): Promise<string[]> {
  const monitored = and(
    projectScope(input.projectId),
    eq(urlInspections.inSitemap, true),
  );
  const tiers = [
    and(monitored, isNull(urlInspections.lastInspectedAt)),
    and(
      monitored,
      lte(urlInspections.lastInspectedAt, input.notIndexedBefore),
      or(
        isNull(urlInspections.verdict),
        ne(urlInspections.verdict, INDEXED_VERDICT),
      ),
    ),
    and(
      monitored,
      lte(urlInspections.lastInspectedAt, input.indexedBefore),
      eq(urlInspections.verdict, INDEXED_VERDICT),
    ),
  ];
  const picked: string[] = [];
  for (const where of tiers) {
    const room = input.limit - picked.length;
    if (room <= 0) break;
    const rows = await db
      .select({ url: urlInspections.url })
      .from(urlInspections)
      .where(where)
      .orderBy(
        asc(urlInspections.lastInspectedAt),
        asc(urlInspections.firstSeenAt),
        asc(urlInspections.url),
      )
      .limit(room);
    picked.push(...rows.map((row) => row.url));
  }
  return picked;
}

async function getByUrls(
  projectId: string,
  urls: string[],
): Promise<UrlInspectionRow[]> {
  const rows: UrlInspectionRow[] = [];
  for (const batch of chunk(urls, URLS_PER_IN_CLAUSE)) {
    rows.push(
      ...(await db
        .select()
        .from(urlInspections)
        .where(
          and(projectScope(projectId), inArray(urlInspections.url, batch)),
        )),
    );
  }
  return rows;
}

/**
 * Store inspection outcomes: each URL's row is inserted or updated (its
 * monitoring flags untouched), then its change row, if any.
 */
async function saveInspections(input: {
  projectId: string;
  rows: Array<{
    url: string;
    firstSeenAt: string;
    latest: Partial<LatestInspection>;
  }>;
  changes: Array<Omit<UrlInspectionChange, "projectId">>;
}) {
  const { projectId } = input;
  await executeInBatches(input.rows, (tx, row) =>
    tx
      .insert(urlInspections)
      .values({
        projectId,
        url: row.url,
        firstSeenAt: row.firstSeenAt,
        ...row.latest,
      })
      .onConflictDoUpdate({
        target: [urlInspections.projectId, urlInspections.url],
        set: row.latest,
      }),
  );
  await executeInBatches(input.changes, (tx, change) =>
    tx
      .insert(urlInspectionChanges)
      .values({ ...change, projectId })
      .onConflictDoNothing(),
  );
}

/** Every monitored URL with its latest inspection. */
async function listMonitored(projectId: string) {
  return db
    .select()
    .from(urlInspections)
    .where(and(projectScope(projectId), eq(urlInspections.inSitemap, true)))
    .orderBy(asc(urlInspections.url));
}

async function countMonitored(projectId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(urlInspections)
    .where(and(projectScope(projectId), eq(urlInspections.inSitemap, true)));
  return row?.total ?? 0;
}

/**
 * The monitored URLs' changes per UTC day, grouped by indexed and
 * previously indexed: a running sum of them gives each day's counts.
 */
async function dailyChanges(projectId: string) {
  const day = sql<string>`substr(${urlInspectionChanges.inspectedAt}, 1, 10)`;
  return db
    .select({
      day,
      indexed: urlInspectionChanges.indexed,
      previousIndexed: urlInspectionChanges.previousIndexed,
      changes: count(),
    })
    .from(urlInspectionChanges)
    .innerJoin(
      urlInspections,
      and(
        eq(urlInspections.projectId, urlInspectionChanges.projectId),
        eq(urlInspections.url, urlInspectionChanges.url),
      ),
    )
    .where(
      and(
        eq(urlInspectionChanges.projectId, projectId),
        eq(urlInspections.inSitemap, true),
      ),
    )
    .groupBy(
      day,
      urlInspectionChanges.indexed,
      urlInspectionChanges.previousIndexed,
    )
    .orderBy(day);
}

export const UrlInspectionRepository = {
  getDueMonitors,
  ensureMonitor,
  claimRun,
  getMonitor,
  updateMonitor,
  addInspections,
  syncSitemapUrls,
  pickDue,
  getByUrls,
  saveInspections,
  listMonitored,
  countMonitored,
  dailyChanges,
};
