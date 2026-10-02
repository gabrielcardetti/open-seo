import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { resetBingTestDb } from "@/server/features/bing/bing-test-db";
import { BingPerformanceService } from "./BingPerformanceService";

const testDb = await vi.hoisted(async () => {
  const { createBingTestDb } = await import("../bing-test-db");
  return createBingTestDb();
});

const mocks = vi.hoisted(() => ({
  getPerformance: vi.fn(),
  getPageQueryStats: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/server/features/gsc/services/GscService", async () => {
  const { GscNotConnectedError: NotConnected } =
    await import("@/server/lib/gscErrors");
  return {
    GscNotConnectedError: NotConnected,
    isExpectedGrantFailure: () => false,
    GscService: { getPerformance: mocks.getPerformance },
  };
});
vi.mock("@/server/features/bing/bingAccess", () => ({
  openBingClientForProject: async () => ({
    connection: { siteUrl: "https://example.com/" },
    client: { getPageQueryStats: mocks.getPageQueryStats },
  }),
}));

const SITE = "https://example.com/";

async function seedQueryBucket(
  periodDate: string,
  query: string,
  metrics: {
    clicks: number;
    impressions: number;
    clickPosition: number | null;
    impressionPosition: number | null;
  },
) {
  await testDb.client.execute({
    sql: `INSERT INTO bing_query_stats
      (project_id, site_url, period_date, query, clicks, impressions, avg_click_position, avg_impression_position)
      VALUES ('proj_1', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      SITE,
      periodDate,
      query,
      metrics.clicks,
      metrics.impressions,
      metrics.clickPosition,
      metrics.impressionPosition,
    ],
  });
}

const tableInput = {
  dimension: "query" as const,
  startDate: "2026-09-01",
  endDate: "2026-09-28",
  sort: "clicks" as const,
  limit: 25,
  offset: 0,
};

describe("BingPerformanceService", () => {
  beforeEach(async () => {
    await resetBingTestDb(testDb.client);
    await testDb.client.execute(
      `INSERT INTO bing_connections (id, project_id, organization_id, site_url, connected_by_user_id)
       VALUES ('conn_1', 'proj_1', 'org_1', '${SITE}', 'user_1')`,
    );
    mocks.getPerformance.mockRejectedValue(new GscNotConnectedError("proj_1"));
  });

  it("sums weekly buckets in range and weights positions by impressions and clicks", async () => {
    await seedQueryBucket("2026-09-07", "seo", {
      clicks: 10,
      impressions: 100,
      clickPosition: 1,
      impressionPosition: 2,
    });
    // A week without clicks: Bing reports no click position.
    await seedQueryBucket("2026-09-14", "seo", {
      clicks: 0,
      impressions: 300,
      clickPosition: null,
      impressionPosition: 6,
    });
    // Outside the range.
    await seedQueryBucket("2026-08-24", "seo", {
      clicks: 50,
      impressions: 500,
      clickPosition: 9,
      impressionPosition: 9,
    });

    const result = await BingPerformanceService.table("proj_1", tableInput);

    expect(result).toMatchObject({
      connected: true,
      totalCount: 1,
      rows: [
        {
          key: "seo",
          clicks: 10,
          impressions: 400,
          ctr: 0.025,
          avgImpressionPosition: 5,
          avgClickPosition: 1,
        },
      ],
    });
  });

  it("filters on the weighted position and counts every matching row for paging", async () => {
    for (const [query, position, impressions] of [
      ["top", 2, 900],
      ["near a", 8, 300],
      ["near b", 15, 600],
      ["far", 40, 800],
    ] as const) {
      await seedQueryBucket("2026-09-07", query, {
        clicks: 1,
        impressions,
        clickPosition: position,
        impressionPosition: position,
      });
    }

    const result = await BingPerformanceService.table("proj_1", {
      ...tableInput,
      minPosition: 5,
      maxPosition: 20,
      sort: "impressions",
      limit: 1,
    });

    expect(result).toMatchObject({
      totalCount: 2,
      rows: [{ key: "near b" }],
    });
  });

  it("aggregates a live drill-down with the same weighting", async () => {
    mocks.getPageQueryStats.mockResolvedValue([
      {
        periodDate: "2026-09-07",
        query: "seo",
        clicks: 2,
        impressions: 100,
        avgClickPosition: 3,
        avgImpressionPosition: 2,
      },
      {
        periodDate: "2026-09-14",
        query: "seo",
        clicks: 6,
        impressions: 300,
        avgClickPosition: 1,
        avgImpressionPosition: 6,
      },
    ]);

    const result = await BingPerformanceService.drilldown("proj_1", {
      page: "https://example.com/a",
    });

    expect(result.rows).toEqual([
      {
        key: "seo",
        clicks: 8,
        impressions: 400,
        ctr: 0.02,
        avgImpressionPosition: 5,
        avgClickPosition: 1.5,
      },
    ]);
  });

  it("joins Bing and Search Console pages across scheme, www and trailing slash", async () => {
    await testDb.client.execute(
      `INSERT INTO bing_page_stats (project_id, site_url, period_date, page, clicks, impressions, avg_click_position, avg_impression_position)
       VALUES ('proj_1', '${SITE}', '2026-09-07', 'https://www.example.com/a/', 4, 40, 3, 3)`,
    );
    mocks.getPerformance.mockResolvedValue({
      rows: [
        {
          keys: ["http://example.com/a"],
          clicks: 9,
          impressions: 90,
          ctr: 0.1,
          position: 2,
        },
      ],
    });

    const result = await BingPerformanceService.compareSearchEngines("proj_1", {
      ...tableInput,
      dimension: "page",
      limit: 10,
    });

    expect(result).toMatchObject({
      googleConnected: true,
      rows: [
        {
          key: "https://www.example.com/a/",
          bing: { clicks: 4 },
          google: { clicks: 9 },
        },
      ],
    });
  });
});
