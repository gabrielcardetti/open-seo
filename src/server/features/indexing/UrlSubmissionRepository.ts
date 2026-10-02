/**
 * The indexing ledger: one row per URL per announcement outcome. Written once
 * for D1 and Postgres; `submittedAt` is app-written ISO text in both.
 */
import { and, count, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import { urlSubmissions } from "@/db/schema";
import type {
  UrlSubmissionChannel,
  UrlSubmissionSource,
  UrlSubmissionStatus,
} from "@/shared/indexing";

type UrlSubmissionRow = typeof urlSubmissions.$inferInsert;

// D1 binds at most 100 parameters per statement; a row has 11 columns.
const ROWS_PER_INSERT = 9;

/** Statuses that count as "announced" for the dedupe window. */
const ANNOUNCED: UrlSubmissionStatus[] = ["received", "pending"];

async function insertSubmissions(rows: UrlSubmissionRow[]) {
  await executeInBatches(chunk(rows, ROWS_PER_INSERT), (tx, batch) =>
    tx.insert(urlSubmissions).values(batch),
  );
}

/** URLs announced successfully at or after `sinceIso`. */
async function getAnnouncedUrlsSince(
  projectId: string,
  sinceIso: string,
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ url: urlSubmissions.url })
    .from(urlSubmissions)
    .where(
      and(
        eq(urlSubmissions.projectId, projectId),
        inArray(urlSubmissions.status, ANNOUNCED),
        gte(urlSubmissions.submittedAt, sinceIso),
      ),
    );
  return new Set(rows.map((row) => row.url));
}

type LogFilters = {
  url?: string;
  status?: UrlSubmissionStatus;
  source?: UrlSubmissionSource;
  channel?: UrlSubmissionChannel;
};

function logWhere(projectId: string, filters: LogFilters): SQL | undefined {
  // LIKE wildcards in the user's text are matched literally.
  const urlPattern = filters.url
    ? `%${filters.url.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    : null;
  return and(
    eq(urlSubmissions.projectId, projectId),
    urlPattern
      ? sql`${urlSubmissions.url} like ${urlPattern} escape '\\'`
      : undefined,
    filters.status ? eq(urlSubmissions.status, filters.status) : undefined,
    filters.source ? eq(urlSubmissions.source, filters.source) : undefined,
    filters.channel ? eq(urlSubmissions.channel, filters.channel) : undefined,
  );
}

/** Newest first, with the total matching count for paging. */
async function listSubmissions(
  projectId: string,
  filters: LogFilters,
  page: { limit: number; offset: number },
) {
  const where = logWhere(projectId, filters);
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: urlSubmissions.id,
        url: urlSubmissions.url,
        channel: urlSubmissions.channel,
        source: urlSubmissions.source,
        status: urlSubmissions.status,
        httpStatus: urlSubmissions.httpStatus,
        errorMessage: urlSubmissions.errorMessage,
        batchId: urlSubmissions.batchId,
        attempts: urlSubmissions.attempts,
        submittedAt: urlSubmissions.submittedAt,
      })
      .from(urlSubmissions)
      .where(where)
      .orderBy(desc(urlSubmissions.submittedAt), desc(urlSubmissions.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(urlSubmissions).where(where),
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

async function countByStatusSince(projectId: string, sinceIso: string) {
  const rows = await db
    .select({ status: urlSubmissions.status, total: count() })
    .from(urlSubmissions)
    .where(
      and(
        eq(urlSubmissions.projectId, projectId),
        gte(urlSubmissions.submittedAt, sinceIso),
      ),
    )
    .groupBy(urlSubmissions.status);
  const counts: Partial<Record<UrlSubmissionStatus, number>> = {};
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
}

export const UrlSubmissionRepository = {
  insertSubmissions,
  getAnnouncedUrlsSince,
  listSubmissions,
  countByStatusSince,
} as const;
