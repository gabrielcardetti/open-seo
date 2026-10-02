import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectSitemapEntries } from "@/server/lib/audit/discovery";
import type * as UrlPolicy from "@/server/lib/audit/url-policy";

// No DNS lookups or start-URL probing in tests.
vi.mock("@/server/lib/audit/url-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof UrlPolicy>()),
  normalizeAndValidateStartUrl: () => Promise.resolve("https://example.com/"),
  resolveStartUrlRedirects: (url: string) =>
    Promise.resolve({ url, poweredBy: null }),
}));

const xml = (body: string) =>
  new Response(`<?xml version="1.0"?>${body}`, {
    headers: { "content-type": "application/xml" },
  });
const index = (...shards: string[]) =>
  xml(
    `<sitemapindex>${shards.map((shard) => `<sitemap><loc>https://example.com/${shard}</loc></sitemap>`).join("")}</sitemapindex>`,
  );
const urlset = (path: string) =>
  xml(`<urlset><url><loc>https://example.com${path}</loc></url></urlset>`);

/** Serve `routes` by path; anything else is a 404. */
function serve(routes: Record<string, () => Promise<Response>>) {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input.toString();
    const route = routes[new URL(url).pathname];
    return route ? route() : Promise.resolve(new Response("", { status: 404 }));
  });
}

describe("collectSitemapEntries", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists URLs in sitemap order, not in the order shards finish loading", async () => {
    serve({
      "/sitemap.xml": () => Promise.resolve(index("one.xml", "two.xml")),
      "/one.xml": () =>
        new Promise((resolve) => setTimeout(() => resolve(urlset("/a")), 20)),
      "/two.xml": () => Promise.resolve(urlset("/b")),
    });

    const collected = await collectSitemapEntries("example.com");

    expect(collected.entries.map((entry) => entry.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("names a shard that answered 5xx as unread, but not a missing default sitemap", async () => {
    serve({
      "/robots.txt": () =>
        Promise.resolve(new Response("Sitemap: https://example.com/index.xml")),
      "/index.xml": () => Promise.resolve(index("one.xml", "two.xml")),
      "/one.xml": () => Promise.resolve(new Response("", { status: 503 })),
      "/two.xml": () => Promise.resolve(urlset("/b")),
    });

    const collected = await collectSitemapEntries("example.com");

    expect(collected.failedSitemaps).toEqual(["https://example.com/one.xml"]);
    expect(collected.entries.map((entry) => entry.url)).toEqual([
      "https://example.com/b",
    ]);
  });

  it("walks the tracked sitemaps on the site instead of robots.txt and /sitemap.xml", async () => {
    serve({
      "/robots.txt": () =>
        Promise.resolve(new Response("Sitemap: https://example.com/old.xml")),
      "/old.xml": () => Promise.resolve(urlset("/old")),
      "/sitemap.xml": () => Promise.resolve(urlset("/default")),
      "/news.xml": () => Promise.resolve(urlset("/news")),
    });

    const collected = await collectSitemapEntries("example.com", [
      "https://example.com/news.xml",
      "https://elsewhere.example/news.xml",
    ]);

    expect(collected.entries.map((entry) => entry.url)).toEqual([
      "https://example.com/news",
    ]);
  });
});
