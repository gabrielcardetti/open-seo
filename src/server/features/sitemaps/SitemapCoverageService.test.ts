import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { BingSnapshotRepository } from "@/server/features/bing/repositories/BingSnapshotRepository";
import {
  resetTestDatabase,
  testDb,
} from "@/server/features/indexing/indexing-test-db";
import { SitemapCoverageService } from "./SitemapCoverageService";
import { SitemapRegistryRepository } from "./SitemapRegistryRepository";

const gsc = vi.hoisted(() => ({
  getByProjectId: vi.fn(),
  canSubmitSitemaps: vi.fn(),
  listSitemaps: vi.fn(),
  submitSitemap: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => ({
  db: (await import("@/server/features/indexing/indexing-test-db")).testDb,
}));
vi.mock("@/db/runBatch", async () => {
  const { testDb } =
    await import("@/server/features/indexing/indexing-test-db");
  return {
    runBatch: async (build: (tx: typeof testDb) => Promise<unknown>[]) => {
      for (const statement of build(testDb)) await statement;
    },
  };
});
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: { getByProjectId: gsc.getByProjectId },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: {
    canSubmitSitemaps: gsc.canSubmitSitemaps,
    listSitemaps: gsc.listSitemaps,
    submitSitemap: gsc.submitSitemap,
  },
  isExpectedGrantFailure: () => false,
}));

const A = "https://example.com/a.xml";
const B = "https://example.com/b.xml";
const STALE = "https://www.example.com/sitemap.xml";
const feed = (url: string) => ({
  url,
  status: "Success",
  type: null,
  urlCount: 10,
  lastCrawledAt: null,
  submittedAt: null,
});

describe("SitemapCoverageService", () => {
  beforeEach(async () => {
    resetTestDatabase();
    gsc.getByProjectId.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedByUserId: "user-1",
    });
    gsc.canSubmitSitemaps.mockResolvedValue(true);
    gsc.listSitemaps.mockResolvedValue([{ path: A }, { path: STALE }]);
    const now = new Date().toISOString();
    await SitemapRegistryRepository.upsertTracked("project-1", A, now);
    await SitemapRegistryRepository.upsertTracked("project-1", B, now);
    await testDb.run(sql`INSERT INTO user VALUES ('user-1')`);
    const site = { projectId: "project-1", siteUrl: "https://example.com/" };
    await BingConnectionRepository.upsert({
      ...site,
      organizationId: "org-1",
      connectedByUserId: "user-1",
      nextSyncAt: now,
    });
    await BingSnapshotRepository.upsertSitemaps(site, [feed(B)], now);
  });

  it("flags tracked sitemaps an engine lacks and lists the ones only engines know", async () => {
    const coverage = await SitemapCoverageService.coverage("project-1");

    expect(
      coverage.tracked.map((row) => [
        row.url,
        row.google.state,
        row.bing.state,
      ]),
    ).toEqual([
      [A, "submitted", "missing"],
      [B, "missing", "submitted"],
    ]);
    expect(coverage.missing).toEqual({ google: 1, bing: 1 });
    expect(coverage.engineOnly).toEqual([
      { url: STALE, google: true, bing: false },
    ]);
  });

  it("asks for a reconnect instead of submitting to Google with a read-only grant", async () => {
    gsc.canSubmitSitemaps.mockResolvedValue(false);

    const result = await SitemapCoverageService.submitToEngines("project-1", {
      engines: ["google"],
      onlyMissing: true,
    });

    expect(result.google).toMatchObject({ reason: "reconnect_required" });
    expect(gsc.submitSitemap).not.toHaveBeenCalled();
  });
});
