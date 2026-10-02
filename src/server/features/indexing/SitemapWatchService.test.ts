import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexingRepository } from "./IndexingRepository";
import { resetTestDatabase } from "./indexing-test-db";
import { SitemapWatchService } from "./SitemapWatchService";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  collectSitemapEntries: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => ({
  db: (await import("./indexing-test-db")).testDb,
}));
vi.mock("@/db/runBatch", async () => ({
  executeInBatches: (await import("./indexing-test-db")).executeSequentially,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: mocks.getProjectById },
}));
vi.mock("@/server/lib/audit/discovery", () => ({
  collectSitemapEntries: mocks.collectSitemapEntries,
}));

const sitemap = (entries: Array<[string, string | null]>) => ({
  origin: "https://example.com",
  truncated: false,
  entries: entries.map(([url, lastmod]) => ({ url, lastmod })),
});

describe("SitemapWatchService.runSitemapCheck", () => {
  beforeEach(async () => {
    resetTestDatabase();
    mocks.getProjectById.mockResolvedValue({
      id: "project-1",
      domain: "example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
    await IndexingRepository.upsertSettings("project-1", {
      indexnowKey: "a1b2c3d4e5f6a7b8",
      indexnowVerifiedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the first inventory as a baseline, then submits new and newer-lastmod URLs", async () => {
    mocks.collectSitemapEntries.mockResolvedValueOnce(
      sitemap([
        ["https://example.com/a", "2026-01-01"],
        ["https://example.com/b", "2026-01-01"],
      ]),
    );
    const first = await SitemapWatchService.runSitemapCheck(
      "project-1",
      "sitemap",
    );
    expect(first).toMatchObject({ ok: true, diff: { baseline: true } });
    expect(fetch).not.toHaveBeenCalled();

    mocks.collectSitemapEntries.mockResolvedValueOnce(
      sitemap([
        ["https://example.com/a", "2026-02-01"],
        ["https://example.com/b", "2026-01-01"],
        ["https://example.com/c", null],
      ]),
    );
    const second = await SitemapWatchService.runSitemapCheck(
      "project-1",
      "sitemap",
    );

    expect(second).toMatchObject({
      ok: true,
      diff: {
        baseline: false,
        newUrls: ["https://example.com/c"],
        changedUrls: ["https://example.com/a"],
      },
      submission: { counts: { received: 2 } },
    });
  });
});
