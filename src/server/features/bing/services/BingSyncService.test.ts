import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BingApiError } from "@/server/lib/bing/bingErrors";
import { resetBingTestDb } from "@/server/features/bing/bing-test-db";
import { BingSyncService } from "./BingSyncService";

const testDb = await vi.hoisted(async () => {
  const { createBingTestDb } = await import("../bing-test-db");
  return createBingTestDb();
});

const client = vi.hoisted(() => ({
  getRankAndTrafficStats: vi.fn(),
  getQueryStats: vi.fn(),
  getPageStats: vi.fn(),
  getCrawlStats: vi.fn(),
  getCrawlIssues: vi.fn(),
  getFeeds: vi.fn(),
  getUrlSubmissionQuota: vi.fn(),
  getLinkCounts: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({
  runBatch: async (build: (tx: unknown) => readonly Promise<unknown>[]) => {
    for (const statement of build(testDb.db)) await statement;
  },
}));
vi.mock("@/server/lib/secretBox", () => ({
  openSecret: async (value: string) => value,
}));
vi.mock("@/server/lib/bing/bingClient", () => ({
  createBingClient: () => client,
}));

const SITE = "https://example.com/";

async function seedConnection(input: { nextSyncAt?: string } = {}) {
  await testDb.client.executeMultiple(`
    INSERT INTO projects (id) VALUES ('proj_1');
    INSERT INTO bing_api_keys (user_id, api_key_encrypted, key_hint)
      VALUES ('user_1', 'key', 'abcd');
  `);
  await testDb.client.execute({
    sql: `INSERT INTO bing_connections
      (id, project_id, organization_id, site_url, connected_by_user_id, next_sync_at)
      VALUES ('conn_1', 'proj_1', 'org_1', ?, 'user_1', ?)`,
    args: [SITE, input.nextSyncAt ?? null],
  });
}

async function connection() {
  const result = await testDb.client.execute(
    "SELECT last_synced_at, last_sync_error, next_sync_at, daily_quota_remaining FROM bing_connections",
  );
  return result.rows[0];
}

async function issues() {
  const result = await testDb.client.execute(
    "SELECT url, resolved_at FROM bing_crawl_issues ORDER BY url",
  );
  return result.rows.map((row) => ({
    url: row.url,
    resolved: row.resolved_at !== null,
  }));
}

const issue = (url: string) => ({
  url,
  httpCode: 404,
  issueFlags: 4,
  inLinks: 1,
});

describe("BingSyncService", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T08:00:00.000Z"));
    await resetBingTestDb(testDb.client);
    client.getRankAndTrafficStats.mockResolvedValue([
      { date: "2026-09-01", clicks: 3, impressions: 40 },
    ]);
    client.getQueryStats.mockResolvedValue([]);
    client.getPageStats.mockResolvedValue([]);
    client.getCrawlStats.mockResolvedValue([]);
    client.getCrawlIssues.mockResolvedValue([]);
    client.getFeeds.mockResolvedValue([]);
    client.getUrlSubmissionQuota.mockResolvedValue({
      daily: 90,
      monthly: 900,
    });
    client.getLinkCounts.mockResolvedValue({ links: [], totalPages: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps syncing the other datasets when one Bing method fails", async () => {
    await seedConnection();
    client.getQueryStats.mockRejectedValue(
      new BingApiError("other", "Bing Webmaster Tools API error: boom", 400),
    );

    const result = await BingSyncService.syncProject("proj_1");

    expect(result.datasets).toMatchObject({
      traffic: "ok",
      queries: "failed",
      pages: "ok",
      quota: "ok",
    });
    const stored = await testDb.client.execute(
      "SELECT clicks FROM bing_traffic_daily",
    );
    expect(stored.rows).toHaveLength(1);
    expect(await connection()).toMatchObject({
      last_synced_at: "2026-09-10T08:00:00.000Z",
      last_sync_error: "queries: Bing Webmaster Tools API error: boom",
      daily_quota_remaining: 90,
    });
  });

  it("stops at a rejected key without marking the project synced", async () => {
    await seedConnection();
    client.getRankAndTrafficStats.mockRejectedValue(
      new BingApiError("auth", "Bing rejected the API key.", 400, 3),
    );

    const result = await BingSyncService.syncProject("proj_1");

    expect(result.stoppedEarly).toBe(true);
    expect(client.getQueryStats).not.toHaveBeenCalled();
    expect(await connection()).toMatchObject({
      last_synced_at: null,
      last_sync_error: "traffic: Bing rejected the API key.",
    });
  });

  it("resolves issues Bing stops reporting and reopens ones it reports again", async () => {
    await seedConnection();
    client.getCrawlIssues.mockResolvedValue([issue("/a"), issue("/b")]);
    await BingSyncService.syncProject("proj_1");

    vi.setSystemTime(new Date("2026-09-11T08:00:00.000Z"));
    client.getCrawlIssues.mockResolvedValue([issue("/b")]);
    await BingSyncService.syncProject("proj_1");
    expect(await issues()).toEqual([
      { url: "/a", resolved: true },
      { url: "/b", resolved: false },
    ]);

    // A failed call says nothing about what was fixed.
    vi.setSystemTime(new Date("2026-09-12T08:00:00.000Z"));
    client.getCrawlIssues.mockRejectedValue(
      new BingApiError("other", "boom", 500),
    );
    await BingSyncService.syncProject("proj_1");
    expect(await issues()).toEqual([
      { url: "/a", resolved: true },
      { url: "/b", resolved: false },
    ]);

    vi.setSystemTime(new Date("2026-09-13T08:00:00.000Z"));
    client.getCrawlIssues.mockResolvedValue([issue("/a")]);
    await BingSyncService.syncProject("proj_1");
    expect(await issues()).toEqual([
      { url: "/a", resolved: false },
      { url: "/b", resolved: true },
    ]);
  });

  it("syncs a due project once per tick and schedules it a day later", async () => {
    await seedConnection({ nextSyncAt: "2026-09-10T07:00:00.000Z" });

    expect(await BingSyncService.runScheduledSyncs()).toEqual({
      ran: 1,
      failed: 0,
    });
    expect(await BingSyncService.runScheduledSyncs()).toEqual({
      ran: 0,
      failed: 0,
    });
    expect(client.getRankAndTrafficStats).toHaveBeenCalledTimes(1);
    expect(await connection()).toMatchObject({
      next_sync_at: "2026-09-11T08:00:00.000Z",
    });
  });

  it("refuses a manual sync within ten minutes of the last one", async () => {
    await seedConnection();
    await BingSyncService.syncNow("proj_1");

    vi.setSystemTime(new Date("2026-09-10T08:05:00.000Z"));
    expect(await BingSyncService.syncNow("proj_1")).toEqual({
      status: "too_soon",
      lastSyncedAt: "2026-09-10T08:00:00.000Z",
      retryAfterSeconds: 300,
    });
  });
});
