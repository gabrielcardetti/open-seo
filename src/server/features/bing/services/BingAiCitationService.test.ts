import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBingTestDb } from "@/server/features/bing/bing-test-db";
import { BingAiCitationService } from "./BingAiCitationService";

const testDb = await vi.hoisted(async () => {
  const { createBingTestDb } = await import("../bing-test-db");
  return createBingTestDb();
});

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({
  runBatch: async (build: (tx: unknown) => readonly Promise<unknown>[]) => {
    for (const statement of build(testDb.db)) await statement;
  },
}));

const PAGES_CSV = "URL,Citations\nhttps://example.com/a,5\n";
const PERIOD = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };

describe("BingAiCitationService.importCsv", () => {
  beforeEach(async () => {
    await resetBingTestDb(testDb.client);
  });

  it("stores undated rows for the given period, and re-importing changes nothing", async () => {
    await BingAiCitationService.importCsv("proj_1", {
      csv: PAGES_CSV,
      ...PERIOD,
    });
    const again = await BingAiCitationService.importCsv("proj_1", {
      csv: PAGES_CSV,
      ...PERIOD,
    });

    expect(again).toMatchObject({ ok: true, kind: "pages", imported: 1 });
    const result = await BingAiCitationService.citations("proj_1", {
      startDate: "2026-09-10",
      endDate: "2026-09-20",
    });
    expect(result.topPages).toEqual([
      { url: "https://example.com/a", citations: 5 },
    ]);
  });

  it("asks for the period when an undated file comes without one", async () => {
    const result = await BingAiCitationService.importCsv("proj_1", {
      csv: PAGES_CSV,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_period" });
  });
});
