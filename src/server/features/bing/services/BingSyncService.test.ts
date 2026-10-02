import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BingApiError } from "@/server/lib/bing/bingErrors";
import { resetBingTestDb } from "@/server/features/bing/bing-test-db";
import { BingService } from "./BingService";
import { BingSiteHealthService } from "./BingSiteHealthService";
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
  getUserSites: vi.fn(),
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
  sealSecret: async (value: string) => value,
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

const feed = (url: string) => ({
  url,
  status: "Success",
  type: null,
  urlCount: 10,
  lastCrawledAt: null,
  submittedAt: null,
});

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
    client.getUserSites.mockResolvedValue([]);
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

    expect(result.stoppedBy).toBe("key");
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

  it("flags sitemaps Bing stops reporting without dropping them", async () => {
    await seedConnection();
    client.getFeeds.mockResolvedValue([feed("/a.xml"), feed("/b.xml")]);
    await BingSyncService.syncProject("proj_1");

    vi.setSystemTime(new Date("2026-09-11T08:00:00.000Z"));
    client.getFeeds.mockResolvedValue([feed("/b.xml")]);
    await BingSyncService.syncProject("proj_1");

    const health = await BingSiteHealthService.crawlHealth("proj_1");
    expect(health.connected && health.sitemaps).toEqual([
      expect.objectContaining({ feedUrl: "/a.xml", noLongerReported: true }),
      expect.objectContaining({ feedUrl: "/b.xml", noLongerReported: false }),
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
      lastAttemptAt: "2026-09-10T08:00:00.000Z",
      retryAfterSeconds: 300,
    });
  });

  it("starts one sync when two manual syncs race", async () => {
    await seedConnection();

    const results = await Promise.all([
      BingSyncService.syncNow("proj_1"),
      BingSyncService.syncNow("proj_1"),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "synced",
      "too_soon",
    ]);
    expect(client.getRankAndTrafficStats).toHaveBeenCalledTimes(1);
  });

  it("stops a throttled sync and still counts it against the manual limit", async () => {
    await seedConnection();
    client.getRankAndTrafficStats.mockRejectedValue(
      new BingApiError("throttled", "Bing is throttling this key.", 429),
    );

    const result = await BingSyncService.syncNow("proj_1");
    expect(result).toMatchObject({ status: "synced", stoppedBy: "throttled" });
    expect(client.getQueryStats).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-09-10T08:01:00.000Z"));
    expect(await BingSyncService.syncNow("proj_1")).toMatchObject({
      status: "too_soon",
    });
  });

  it("allows a manual sync right after the connector saves a new key", async () => {
    await seedConnection();
    await BingSyncService.syncNow("proj_1");

    vi.setSystemTime(new Date("2026-09-10T08:01:00.000Z"));
    await BingService.saveApiKey("user_1", "new-api-key");

    expect(await BingSyncService.syncNow("proj_1")).toMatchObject({
      status: "synced",
    });
  });

  it("drops the result of a sync that finishes after the site was switched", async () => {
    await seedConnection();
    client.getRankAndTrafficStats.mockImplementation(async () => {
      await testDb.client.execute(
        "UPDATE bing_connections SET site_url = 'https://other.example/'",
      );
      return [{ date: "2026-09-01", clicks: 3, impressions: 40 }];
    });

    await BingSyncService.syncProject("proj_1");

    expect(await connection()).toMatchObject({
      last_synced_at: null,
      daily_quota_remaining: null,
    });
    const stored = await testDb.client.execute(
      "SELECT site_url FROM bing_traffic_daily",
    );
    expect(stored.rows).toEqual([expect.objectContaining({ site_url: SITE })]);
  });
});
