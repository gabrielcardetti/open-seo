import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase } from "@/server/features/indexing/indexing-test-db";
import type * as UrlPolicy from "@/server/lib/audit/url-policy";
import { SitemapRegistryService } from "./SitemapRegistryService";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => ({
  db: (await import("@/server/features/indexing/indexing-test-db")).testDb,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {
    getProjectById: () =>
      Promise.resolve({ id: "project-1", domain: "example.com" }),
  },
}));
// No DNS lookups or start-URL probing in tests.
vi.mock("@/server/lib/audit/url-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof UrlPolicy>()),
  normalizeAndValidateStartUrl: (url: string) => Promise.resolve(url),
  resolveStartUrlRedirects: () =>
    Promise.resolve({ url: "https://example.com/", poweredBy: null }),
}));

const ROBOTS = [
  "Sitemap: https://www.example.com/news.xml",
  "Sitemap: https://other.example/sitemap.xml",
  "Sitemap: https://example.com/old.xml",
].join("\n");

describe("SitemapRegistryService", () => {
  beforeEach(() => {
    resetTestDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const { pathname } = new URL(input);
        if (pathname === "/robots.txt") {
          return Promise.resolve(new Response(ROBOTS));
        }
        if (pathname === "/sitemap.xml") {
          return Promise.resolve(
            new Response("<urlset></urlset>", {
              headers: { "content-type": "application/xml" },
            }),
          );
        }
        return Promise.resolve(new Response("", { status: 404 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("suggests the site's own sitemaps once, never other hosts or ignored ones", async () => {
    await SitemapRegistryService.update("project-1", {
      ignore: ["https://example.com/old.xml"],
    });

    const first = await SitemapRegistryService.detect("project-1");
    const again = await SitemapRegistryService.detect("project-1");

    expect(first.suggested).toEqual([
      "https://www.example.com/news.xml",
      "https://example.com/sitemap.xml",
    ]);
    expect(again.suggested).toEqual([]);
    const registry = await SitemapRegistryService.list("project-1");
    expect(registry.ignored.map((row) => row.url)).toEqual([
      "https://example.com/old.xml",
    ]);
  });

  it("tracks a sitemap added by hand only when it answers as a sitemap", async () => {
    const { changes } = await SitemapRegistryService.update("project-1", {
      add: [
        "https://example.com/sitemap.xml",
        "https://example.com/missing.xml",
      ],
    });

    expect(changes.map(({ url, ok }) => ({ url, ok }))).toEqual([
      { url: "https://example.com/sitemap.xml", ok: true },
      { url: "https://example.com/missing.xml", ok: false },
    ]);
    expect(await SitemapRegistryService.trackedUrls("project-1")).toEqual([
      "https://example.com/sitemap.xml",
    ]);
  });
});
