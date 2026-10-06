import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GscApiError } from "@/server/lib/gscErrors";
import type { UrlInspectionResult } from "@/server/lib/gscClient";
import { UrlInspectionRepository } from "@/server/features/gsc/repositories/UrlInspectionRepository";
import {
  connectSearchConsole,
  resetTestDatabase,
} from "@/server/features/indexing/indexing-test-db";
import { indexingStatusFiltersSchema } from "@/types/schemas/indexing";
import { GscService } from "./GscService";
import { IndexingMonitorService } from "./IndexingMonitorService";
import { UrlInspectionService } from "./UrlInspectionService";

const mocks = vi.hoisted(() => ({
  inspectUrl: vi.fn<(siteUrl: string, url: string) => Promise<unknown>>(),
  collectSitemapEntries: vi.fn(),
  getProjectById: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => ({
  db: (await import("@/server/features/indexing/indexing-test-db")).testDb,
}));
vi.mock("@/db/runBatch", async () => ({
  executeInBatches: (
    await import("@/server/features/indexing/indexing-test-db")
  ).executeSequentially,
}));
vi.mock("@/server/lib/gscClient", () => ({
  createGscClient: () => ({ inspectUrl: mocks.inspectUrl }),
}));
vi.mock("@/server/lib/audit/discovery", () => ({
  collectSitemapEntries: mocks.collectSitemapEntries,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: mocks.getProjectById },
}));

const SITE = "https://example.com";
const INDEXED = { verdict: "PASS", coverageState: "Submitted and indexed" };
const CRAWLED = {
  verdict: "NEUTRAL",
  coverageState: "Crawled - currently not indexed",
};

/** What Google answers per path; unknown paths are unknown to Google. */
let google: Record<string, UrlInspectionResult["indexStatusResult"]> = {};

const listSitemap = (...paths: string[]) =>
  mocks.collectSitemapEntries.mockResolvedValue({
    origin: SITE,
    truncated: false,
    failedSitemaps: [],
    entries: paths.map((path) => ({
      url: `${SITE}${path}`,
      lastmod: null,
      sitemap: `${SITE}/sitemap.xml`,
    })),
  });

const inspectedPaths = () =>
  mocks.inspectUrl.mock.calls.map(([, url]) => url.slice(SITE.length));

const tickAt = async (iso: string) => {
  vi.setSystemTime(iso);
  mocks.inspectUrl.mockClear();
  await IndexingMonitorService.runScheduledInspections();
};

const status = () =>
  UrlInspectionService.status(
    "project-1",
    indexingStatusFiltersSchema.parse({}),
  );

describe("indexing monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetTestDatabase();
    connectSearchConsole("sc-domain:example.com");
    google = {};
    mocks.getProjectById.mockResolvedValue({ domain: "example.com" });
    mocks.inspectUrl.mockImplementation((_siteUrl, url) =>
      Promise.resolve({
        indexStatusResult: google[url.slice(SITE.length)] ?? {
          verdict: "NEUTRAL",
          coverageState: "URL is unknown to Google",
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("inspects new sitemap URLs first within the daily budget and stops monitoring URLs that left the sitemaps", async () => {
    listSitemap("/a", "/b");
    google = { "/a": INDEXED, "/b": CRAWLED };
    await tickAt("2026-10-01T10:00:00.000Z");
    expect(inspectedPaths()).toEqual(["/a", "/b"]);

    // Two days on, /b is due a recheck, but two inspections are left today
    // and the new URLs come first; /a left the sitemaps.
    listSitemap("/b", "/c", "/d");
    await UrlInspectionRepository.addInspections(
      "project-1",
      1_498,
      "2026-10-03",
      "2026-10-03T09:00:00.000Z",
    );
    await tickAt("2026-10-03T10:00:00.000Z");
    expect(inspectedPaths()).toEqual(["/c", "/d"]);

    expect((await status()).totals).toMatchObject({
      monitored: 3,
      indexed: 0,
      notIndexed: 3,
    });
  });

  it("reports templates, the daily trend and problems from the inspection history", async () => {
    listSitemap("/jobs/123", "/jobs/456", "/about");
    google = {
      "/jobs/123": INDEXED,
      "/jobs/456": {
        ...CRAWLED,
        googleCanonical: `${SITE}/jobs/123`,
        userCanonical: `${SITE}/jobs/456`,
      },
      "/about": INDEXED,
    };
    await tickAt("2026-10-01T10:00:00.000Z");
    // A week on every URL is due again, and /jobs/123 dropped out.
    google["/jobs/123"] = CRAWLED;
    await tickAt("2026-10-09T10:00:00.000Z");
    expect(inspectedPaths()).toHaveLength(3);

    const result = await status();
    expect(result.byTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          template: "/jobs/:id",
          urls: 2,
          notIndexed: 2,
        }),
        expect.objectContaining({ template: "/about", urls: 1, indexed: 1 }),
      ]),
    );
    expect(result.trend.at(0)).toEqual({
      date: "2026-10-01",
      indexed: 2,
      notIndexed: 1,
    });
    expect(result.trend.find((point) => point.date === "2026-10-05")).toEqual({
      date: "2026-10-05",
      indexed: 2,
      notIndexed: 1,
    });
    expect(result.trend.at(-1)).toEqual({
      date: "2026-10-09",
      indexed: 1,
      notIndexed: 2,
    });
    expect(
      result.problems.map(({ url, kinds }) => [url.slice(SITE.length), kinds]),
    ).toEqual([
      ["/jobs/123", ["lost_indexing", "not_indexed_after_days"]],
      ["/jobs/456", ["canonical_mismatch", "not_indexed_after_days"]],
    ]);
  });

  it("stops sending inspections once Search Console rate-limits", async () => {
    mocks.inspectUrl.mockImplementation((_siteUrl, url) =>
      url.endsWith("/1")
        ? Promise.reject(new GscApiError(429, "Rate limit"))
        : Promise.resolve({ indexStatusResult: INDEXED }),
    );
    const urls = [1, 2, 3, 4, 5, 6, 7].map((n) => `${SITE}/${n}`);

    const { results } = await GscService.inspectUrls({
      projectId: "project-1",
      urls,
    });

    expect(mocks.inspectUrl).toHaveBeenCalledTimes(5);
    expect(results.filter((result) => result.skipped)).toHaveLength(2);
  });
});
