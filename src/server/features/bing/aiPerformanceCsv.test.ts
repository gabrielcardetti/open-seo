import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAiPerformanceCsv } from "./aiPerformanceCsv";

// Synthetic files: no real AI Performance export has been checked yet (see
// the TODO in aiPerformanceCsv.ts).

describe("parseAiPerformanceCsv", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads daily totals with a BOM, a preamble, semicolons and mixed date formats", () => {
    const csv = [
      "﻿AI Performance report",
      "Date;Citations;Average Cited Pages",
      "2026-09-01;1.234;3",
      '"Sep 2, 2026";12;',
      "9/3/2026;7;2",
      "Total;1253;",
    ].join("\r\n");

    expect(parseAiPerformanceCsv(csv)).toEqual({
      ok: true,
      kind: "daily",
      rows: [
        { date: "2026-09-01", citations: 1234, citedPages: 3 },
        { date: "2026-09-02", citations: 12, citedPages: null },
        { date: "2026-09-03", citations: 7, citedPages: 2 },
      ],
      skipped: [{ line: 6, reason: 'Unrecognized date "Total"' }],
    });
  });

  it("detects a per-page file, quoted fields and a thousands separator", () => {
    const csv = [
      "URL,Citations",
      '"https://example.com/a?x=1,2","1,500"',
      "https://example.com/b,3",
    ].join("\n");

    expect(parseAiPerformanceCsv(csv)).toMatchObject({
      ok: true,
      kind: "pages",
      rows: [
        { date: null, url: "https://example.com/a?x=1,2", citations: 1500 },
        { date: null, url: "https://example.com/b", citations: 3 },
      ],
    });
  });

  it("detects grounding queries with a date column", () => {
    const csv = "Grounding query,Date,Citations\nbest seo tools,1 Sep 2026,4\n";

    expect(parseAiPerformanceCsv(csv)).toMatchObject({
      kind: "queries",
      rows: [{ date: "2026-09-01", query: "best seo tools", citations: 4 }],
    });
  });

  it("skips rows with dates or counts outside what Bing can report", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T08:00:00.000Z"));
    const csv = [
      "Date,Citations,Cited pages",
      "2026-09-11,1,1",
      "2026-09-12,1,1",
      "2022-12-31,1,1",
      "2026-09-01,-3,1",
      "2026-09-02,3000000000,1",
      "2026-09-03,2,99999999999",
    ].join("\n");

    expect(parseAiPerformanceCsv(csv)).toEqual({
      ok: true,
      kind: "daily",
      rows: [{ date: "2026-09-11", citations: 1, citedPages: 1 }],
      skipped: [
        { line: 3, reason: "Date 2026-09-12 is out of range" },
        { line: 4, reason: "Date 2022-12-31 is out of range" },
        { line: 5, reason: "Citations -3 is out of range" },
        { line: 6, reason: "Citations 3000000000 is out of range" },
        { line: 7, reason: "Cited pages 99999999999 is out of range" },
      ],
    });
  });

  it("rejects a file without a Citations column", () => {
    expect(parseAiPerformanceCsv("Query,Clicks\nseo,4\n")).toMatchObject({
      ok: false,
    });
  });
});
