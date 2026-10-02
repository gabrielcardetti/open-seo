import { and, asc, between, desc, eq, gte, lte, sql } from "drizzle-orm";
import { uniqueBy } from "remeda";
import { db } from "@/db";
import {
  bingAiCitationsDaily,
  bingAiCitedPages,
  bingAiGroundingQueries,
} from "@/db/schema";
import { writeRowsInChunks } from "./chunkedWrites";

type Period = { periodStart: string; periodEnd: string };

// Imports upsert on the natural key, so re-importing a file changes nothing
// and a corrected export overwrites the earlier numbers. Within one file the
// first row for a key wins (one statement can't upsert a key twice on
// Postgres).

async function upsertDaily(
  projectId: string,
  days: Array<{ date: string; citations: number; citedPages: number | null }>,
  now: string,
): Promise<void> {
  const rows = uniqueBy(days, (day) => day.date).map((day) => ({
    projectId,
    ...day,
    importedAt: now,
  }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingAiCitationsDaily)
      .values(chunk)
      .onConflictDoUpdate({
        target: [bingAiCitationsDaily.projectId, bingAiCitationsDaily.date],
        set: {
          citations: sql`excluded.citations`,
          citedPages: sql`excluded.cited_pages`,
          importedAt: now,
        },
      }),
  );
}

async function upsertCitedPages(
  projectId: string,
  pages: Array<Period & { url: string; citations: number }>,
  now: string,
): Promise<void> {
  const rows = uniqueBy(
    pages,
    (page) => `${page.periodStart}\n${page.periodEnd}\n${page.url}`,
  ).map((page) => ({ projectId, ...page, importedAt: now }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingAiCitedPages)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingAiCitedPages.projectId,
          bingAiCitedPages.periodStart,
          bingAiCitedPages.periodEnd,
          bingAiCitedPages.url,
        ],
        set: { citations: sql`excluded.citations`, importedAt: now },
      }),
  );
}

async function upsertGroundingQueries(
  projectId: string,
  queries: Array<Period & { query: string; citations: number }>,
  now: string,
): Promise<void> {
  const rows = uniqueBy(
    queries,
    (row) => `${row.periodStart}\n${row.periodEnd}\n${row.query}`,
  ).map((row) => ({ projectId, ...row, importedAt: now }));
  await writeRowsInChunks(rows, (tx, chunk) =>
    tx
      .insert(bingAiGroundingQueries)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          bingAiGroundingQueries.projectId,
          bingAiGroundingQueries.periodStart,
          bingAiGroundingQueries.periodEnd,
          bingAiGroundingQueries.query,
        ],
        set: { citations: sql`excluded.citations`, importedAt: now },
      }),
  );
}

async function getLatestDailyDate(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ latest: sql<string | null>`max(${bingAiCitationsDaily.date})` })
    .from(bingAiCitationsDaily)
    .where(eq(bingAiCitationsDaily.projectId, projectId));
  return row?.latest ?? null;
}

async function getDaily(projectId: string, startDate: string, endDate: string) {
  return db
    .select({
      date: bingAiCitationsDaily.date,
      citations: bingAiCitationsDaily.citations,
      citedPages: bingAiCitationsDaily.citedPages,
    })
    .from(bingAiCitationsDaily)
    .where(
      and(
        eq(bingAiCitationsDaily.projectId, projectId),
        between(bingAiCitationsDaily.date, startDate, endDate),
      ),
    )
    .orderBy(asc(bingAiCitationsDaily.date));
}

/** Pages cited in imported periods that overlap the range, summed per URL. */
async function getTopCitedPages(
  projectId: string,
  startDate: string,
  endDate: string,
  limit: number,
) {
  const citations = sql`sum(${bingAiCitedPages.citations})`;
  return db
    .select({
      url: bingAiCitedPages.url,
      citations: citations.mapWith(Number),
    })
    .from(bingAiCitedPages)
    .where(
      and(
        eq(bingAiCitedPages.projectId, projectId),
        lte(bingAiCitedPages.periodStart, endDate),
        gte(bingAiCitedPages.periodEnd, startDate),
      ),
    )
    .groupBy(bingAiCitedPages.url)
    .orderBy(desc(citations), asc(bingAiCitedPages.url))
    .limit(limit);
}

async function getTopGroundingQueries(
  projectId: string,
  startDate: string,
  endDate: string,
  limit: number,
) {
  const citations = sql`sum(${bingAiGroundingQueries.citations})`;
  return db
    .select({
      query: bingAiGroundingQueries.query,
      citations: citations.mapWith(Number),
    })
    .from(bingAiGroundingQueries)
    .where(
      and(
        eq(bingAiGroundingQueries.projectId, projectId),
        lte(bingAiGroundingQueries.periodStart, endDate),
        gte(bingAiGroundingQueries.periodEnd, startDate),
      ),
    )
    .groupBy(bingAiGroundingQueries.query)
    .orderBy(desc(citations), asc(bingAiGroundingQueries.query))
    .limit(limit);
}

export const BingAiRepository = {
  upsertDaily,
  upsertCitedPages,
  upsertGroundingQueries,
  getLatestDailyDate,
  getDaily,
  getTopCitedPages,
  getTopGroundingQueries,
};
