import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

const sitemap = (
  entries: Array<[string, string | null]>,
  failedSitemaps: string[] = [],
) => ({
  origin: "https://example.com",
  truncated: false,
  failedSitemaps,
  entries: entries.map(([url, lastmod]) => ({ url, lastmod })),
});

const check = () => SitemapWatchService.runSitemapCheck("project-1", "sitemap");

/** The URL lists POSTed to IndexNow, one per request. */
const sentUrlLists = () =>
  vi.mocked(fetch).mock.calls.map(([, init]) => {
    const body: unknown = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    );
    return z.object({ urlList: z.array(z.string()) }).parse(body).urlList;
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

  it("sends only new URLs when the sitemap stamps every lastmod with the current time", async () => {
    const pages = Array.from(
      { length: 10 },
      (_, index) => `https://example.com/p${index}`,
    );
    mocks.collectSitemapEntries.mockResolvedValueOnce(
      sitemap(pages.map((url) => [url, "2026-01-01T00:00:00Z"])),
    );
    await check();

    const now = new Date().toISOString();
    mocks.collectSitemapEntries.mockResolvedValueOnce(
      sitemap([
        ...pages.map((url): [string, string] => [url, now]),
        ["https://example.com/new", now],
      ]),
    );
    const outcome = await check();

    expect(sentUrlLists()).toEqual([["https://example.com/new"]]);
    const settings = await IndexingRepository.getSettings("project-1");
    expect(settings?.lastSitemapError).toContain("<lastmod>");
    expect(outcome.ok && outcome.warning).toBe(settings?.lastSitemapError);
  });

  it("sends a URL again on the next check when IndexNow failed", async () => {
    mocks.collectSitemapEntries.mockResolvedValue(
      sitemap([["https://example.com/a", null]]),
    );
    await check();
    mocks.collectSitemapEntries.mockResolvedValue(
      sitemap([
        ["https://example.com/a", null],
        ["https://example.com/c", null],
      ]),
    );
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    const failed = await check();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const retried = await check();

    expect(failed).toMatchObject({ submission: { counts: { failed: 1 } } });
    expect(retried).toMatchObject({
      diff: { newUrls: ["https://example.com/c"] },
      submission: { counts: { received: 1 } },
    });
  });

  it("records and sends nothing when a sitemap document could not be read", async () => {
    mocks.collectSitemapEntries.mockResolvedValueOnce(
      sitemap([
        ["https://example.com/a", null],
        ["https://example.com/b", null],
      ]),
    );
    await check();
    mocks.collectSitemapEntries.mockResolvedValueOnce(
      sitemap(
        [
          ["https://example.com/a", null],
          ["https://example.com/c", null],
        ],
        ["https://example.com/sitemap-2.xml"],
      ),
    );
    const partial = await check();
    mocks.collectSitemapEntries.mockResolvedValueOnce(
      sitemap([
        ["https://example.com/a", null],
        ["https://example.com/b", null],
        ["https://example.com/c", null],
      ]),
    );
    const complete = await check();

    expect(partial.ok ? null : partial.problem).toContain(
      "https://example.com/sitemap-2.xml",
    );
    expect(complete).toMatchObject({
      diff: { newUrls: ["https://example.com/c"], removedUrls: [] },
    });
    expect(sentUrlLists()).toEqual([["https://example.com/c"]]);
  });
});
