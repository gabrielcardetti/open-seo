import {
  parseAiPerformanceCsv,
  type AiCsvKind,
} from "@/server/features/bing/aiPerformanceCsv";
import {
  resolveRange,
  type DateRangeInput,
} from "@/server/features/bing/bingStats";
import { BingAiRepository } from "@/server/features/bing/repositories/BingAiRepository";

const DEFAULT_RANGE_DAYS = 28;
const TOP_LIMIT = 50;
const SKIPPED_ROWS_RETURNED = 20;

type ImportResult =
  | {
      ok: true;
      kind: AiCsvKind;
      imported: number;
      skippedCount: number;
      skipped: Array<{ line: number; reason: string }>;
    }
  | { ok: false; reason: "unrecognized" | "missing_period"; message: string };

/**
 * Import a Bing AI Performance CSV export (Copilot / Bing AI citations).
 * Idempotent: rows upsert by natural key, so importing the same file twice
 * changes nothing. Per-page and per-query rows without a date are stored for
 * the caller's period (the range the export was taken over).
 */
async function importCsv(
  projectId: string,
  input: {
    csv: string;
    kind?: AiCsvKind;
    periodStart?: string;
    periodEnd?: string;
  },
): Promise<ImportResult> {
  const parsed = parseAiPerformanceCsv(input.csv, input.kind);
  if (!parsed.ok) {
    return { ok: false, reason: "unrecognized", message: parsed.message };
  }
  const now = new Date().toISOString();
  const periodFor = (date: string | null) =>
    date
      ? { periodStart: date, periodEnd: date }
      : input.periodStart && input.periodEnd
        ? { periodStart: input.periodStart, periodEnd: input.periodEnd }
        : null;

  if (
    parsed.kind !== "daily" &&
    parsed.rows.some((row) => !periodFor(row.date))
  ) {
    return {
      ok: false,
      reason: "missing_period",
      message:
        "This export has no dates. Give the start and end date of the period it covers.",
    };
  }

  switch (parsed.kind) {
    case "daily":
      await BingAiRepository.upsertDaily(projectId, parsed.rows, now);
      break;
    case "pages":
      await BingAiRepository.upsertCitedPages(
        projectId,
        parsed.rows.flatMap((row) => {
          const period = periodFor(row.date);
          return period
            ? [{ ...period, url: row.url, citations: row.citations }]
            : [];
        }),
        now,
      );
      break;
    case "queries":
      await BingAiRepository.upsertGroundingQueries(
        projectId,
        parsed.rows.flatMap((row) => {
          const period = periodFor(row.date);
          return period
            ? [{ ...period, query: row.query, citations: row.citations }]
            : [];
        }),
        now,
      );
      break;
  }
  return {
    ok: true,
    kind: parsed.kind,
    imported: parsed.rows.length,
    skippedCount: parsed.skipped.length,
    skipped: parsed.skipped.slice(0, SKIPPED_ROWS_RETURNED),
  };
}

/**
 * AI citations from imported exports: the daily series for the range, and
 * the pages and grounding queries of every imported period that overlaps it
 * (summed, so overlapping imports of different periods add up).
 */
async function citations(projectId: string, input: DateRangeInput = {}) {
  const range = resolveRange(
    input,
    await BingAiRepository.getLatestDailyDate(projectId),
    DEFAULT_RANGE_DAYS,
  );
  const [daily, topPages, topQueries] = await Promise.all([
    BingAiRepository.getDaily(projectId, range.startDate, range.endDate),
    BingAiRepository.getTopCitedPages(
      projectId,
      range.startDate,
      range.endDate,
      TOP_LIMIT,
    ),
    BingAiRepository.getTopGroundingQueries(
      projectId,
      range.startDate,
      range.endDate,
      TOP_LIMIT,
    ),
  ]);
  return {
    range,
    hasData: daily.length > 0 || topPages.length > 0 || topQueries.length > 0,
    totalCitations: daily.reduce((sum, day) => sum + day.citations, 0),
    daily,
    topPages,
    topQueries,
  };
}

export const BingAiCitationService = {
  importCsv,
  citations,
};
