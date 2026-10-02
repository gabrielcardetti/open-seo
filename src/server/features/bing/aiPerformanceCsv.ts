import Papa from "papaparse";

// TODO: written before we had a real Bing Webmaster "AI Performance" export.
// Check the parser against one (column names, date format, preamble lines,
// whether per-page / per-query files carry dates) and tighten the aliases.

export type AiCsvKind = "daily" | "pages" | "queries";

type SkippedRow = { line: number; reason: string };

type ParsedAiCsv =
  | {
      ok: true;
      kind: "daily";
      rows: Array<{
        date: string;
        citations: number;
        citedPages: number | null;
      }>;
      skipped: SkippedRow[];
    }
  | {
      ok: true;
      kind: "pages";
      rows: Array<{ date: string | null; url: string; citations: number }>;
      skipped: SkippedRow[];
    }
  | {
      ok: true;
      kind: "queries";
      rows: Array<{ date: string | null; query: string; citations: number }>;
      skipped: SkippedRow[];
    }
  | { ok: false; message: string };

// Header cells compared lowercased with everything but letters removed, so
// "Average cited pages", "average_cited_pages" and "AverageCitedPages" match.
const DATE_HEADERS = ["date", "day"];
const CITATION_HEADERS = [
  "citations",
  "citation",
  "totalcitations",
  "citationcount",
  "aicitations",
];
const CITED_PAGES_HEADERS = [
  "citedpages",
  "averagecitedpages",
  "avgcitedpages",
  "numberofcitedpages",
];
const URL_HEADERS = [
  "url",
  "urls",
  "page",
  "pageurl",
  "citedpage",
  "citedurl",
  "landingpage",
];
const QUERY_HEADERS = [
  "query",
  "queries",
  "groundingquery",
  "groundingqueries",
  "searchquery",
  "keyword",
];
// Preamble lines (report title, date range) may precede the header row.
const HEADER_SEARCH_ROWS = 10;
// Bing's AI Performance report starts in 2023; a later date than tomorrow
// (UTC, so any timezone's today fits) is a misread, not a citation day.
const EARLIEST_DATE = "2023-01-01";
// Counts are stored as 32-bit integers on Postgres.
const MAX_COUNT = 2 ** 31 - 1;

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function headerKey(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z]/g, "");
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** 2026-09-01, 9/1/2026 (US order unless the first part can't be a month),
 *  "Sep 1, 2026", "September 1 2026" and "1 Sep 2026". */
function parseDate(value: string): string | null {
  const text = value.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match)
    return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    return first > 12
      ? isoDate(Number(match[3]), second, first)
      : isoDate(Number(match[3]), first, second);
  }
  match = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
    return month > 0
      ? isoDate(Number(match[3]), month, Number(match[2]))
      : null;
  }
  match = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    return month > 0
      ? isoDate(Number(match[3]), month, Number(match[1]))
      : null;
  }
  return null;
}

/** "1,234", "1.234,5", "12.5" and "12,5" (a decimal comma). */
function parseNumber(value: string): number | null {
  let text = value.trim().replace(/[\s%]/g, "");
  if (!text) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else text = text.replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function countProblem(label: string, value: number | null): string | null {
  if (value === null) return null;
  return value < 0 || Math.round(value) > MAX_COUNT
    ? `${label} ${value} is out of range`
    : null;
}

function findColumn(header: string[], names: string[]): number {
  return header.findIndex((cell) => names.includes(headerKey(cell)));
}

/**
 * Parse a Bing AI Performance CSV export: daily totals (Date, Citations,
 * optionally Cited pages), citations per page (URL/Page, Citations,
 * optionally Date) or per grounding query (Query, Citations, optionally
 * Date). The kind is detected from the header unless given.
 */
export function parseAiPerformanceCsv(
  text: string,
  kindHint?: AiCsvKind,
): ParsedAiCsv {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    skipEmptyLines: "greedy",
  });
  const lines = parsed.data;
  const headerIndex = lines
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((cells) => findColumn(cells, CITATION_HEADERS) !== -1);
  if (headerIndex === -1) {
    return {
      ok: false,
      message: "No Citations column found. Upload an AI Performance export.",
    };
  }
  const header = lines[headerIndex];
  const columns = {
    date: findColumn(header, DATE_HEADERS),
    citations: findColumn(header, CITATION_HEADERS),
    citedPages: findColumn(header, CITED_PAGES_HEADERS),
    url: findColumn(header, URL_HEADERS),
    query: findColumn(header, QUERY_HEADERS),
  };
  const dataRows = lines
    .slice(headerIndex + 1)
    .map((cells, index) => ({ cells, line: headerIndex + index + 2 }));

  // A "Cited pages" column holding URLs is a per-page file, not a count.
  const firstCitedPages =
    columns.citedPages === -1
      ? ""
      : (dataRows[0]?.cells[columns.citedPages] ?? "");
  if (columns.url === -1 && /^https?:\/\//i.test(firstCitedPages.trim())) {
    columns.url = columns.citedPages;
    columns.citedPages = -1;
  }

  const kind: AiCsvKind | null =
    kindHint ??
    (columns.url !== -1
      ? "pages"
      : columns.query !== -1
        ? "queries"
        : columns.date !== -1
          ? "daily"
          : null);
  const keyColumn =
    kind === "pages" ? columns.url : kind === "queries" ? columns.query : -1;
  if (!kind || (kind === "daily" ? columns.date : keyColumn) === -1) {
    return {
      ok: false,
      message:
        "Couldn't tell what this export holds. Expected Date + Citations (daily), URL + Citations (pages) or Query + Citations (grounding queries).",
    };
  }

  const latestDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const skipped: SkippedRow[] = [];
  const valid = dataRows.flatMap(({ cells, line }) => {
    const citations = parseNumber(cells[columns.citations] ?? "");
    if (citations === null) {
      skipped.push({ line, reason: "Citations isn't a number" });
      return [];
    }
    const rawDate = columns.date === -1 ? "" : (cells[columns.date] ?? "");
    const date = rawDate.trim() ? parseDate(rawDate) : null;
    if (rawDate.trim() && !date) {
      skipped.push({ line, reason: `Unrecognized date "${rawDate.trim()}"` });
      return [];
    }
    if (date && (date < EARLIEST_DATE || date > latestDate)) {
      skipped.push({ line, reason: `Date ${date} is out of range` });
      return [];
    }
    const key = keyColumn === -1 ? "" : (cells[keyColumn] ?? "").trim();
    if (kind === "daily" ? !date : !key) {
      skipped.push({
        line,
        reason: kind === "daily" ? "Missing date" : "Missing URL or query",
      });
      return [];
    }
    const citedPages =
      columns.citedPages === -1
        ? null
        : parseNumber(cells[columns.citedPages] ?? "");
    const outOfRange =
      countProblem("Citations", citations) ??
      countProblem("Cited pages", citedPages);
    if (outOfRange) {
      skipped.push({ line, reason: outOfRange });
      return [];
    }
    return [
      {
        date,
        key,
        citations: Math.round(citations),
        citedPages: citedPages === null ? null : Math.round(citedPages),
      },
    ];
  });

  switch (kind) {
    case "daily":
      return {
        ok: true,
        kind,
        skipped,
        rows: valid.flatMap((row) =>
          row.date
            ? [
                {
                  date: row.date,
                  citations: row.citations,
                  citedPages: row.citedPages,
                },
              ]
            : [],
        ),
      };
    case "pages":
      return {
        ok: true,
        kind,
        skipped,
        rows: valid.map((row) => ({
          date: row.date,
          url: row.key,
          citations: row.citations,
        })),
      };
    case "queries":
      return {
        ok: true,
        kind,
        skipped,
        rows: valid.map((row) => ({
          date: row.date,
          query: row.key,
          citations: row.citations,
        })),
      };
  }
}
