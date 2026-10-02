import { describe, expect, it } from "vitest";
import { buildBingSiteFacts, type BingInventoryPage } from "./bing-site-facts";

const ORIGIN = "https://example.com";

function page(path: string, overrides: Partial<BingInventoryPage> = {}) {
  return {
    url: `${ORIGIN}${path}`,
    statusCode: 200,
    isIndexable: true,
    title: path,
    contentHash: path,
    ...overrides,
  };
}

const robots = (robotsText: string, pages = [page("/"), page("/blog/a")]) =>
  buildBingSiteFacts({ pages, startUrl: `${ORIGIN}/`, robotsText }).robots;

describe("robots.txt as Bingbot reads it", () => {
  // Bingbot ignores `*` once it has its own group, so a rule left out of
  // that group is a path Bing crawls and every other bot skips.
  it("lists the generic rules a Bingbot group leaves out", () => {
    const facts = robots(
      "User-agent: *\nDisallow: /cart/\nDisallow: /tmp/\n\nUser-agent: bingbot\nDisallow: /tmp/\nCrawl-delay: 1\n",
    );
    expect(facts?.droppedRules).toEqual(["Disallow: /cart/"]);
  });

  it("does not count rules a stricter Bingbot group already covers", () => {
    const facts = robots(
      "User-agent: *\nDisallow: /cart/\n\nUser-agent: Bingbot\nDisallow: /\n",
    );
    expect(facts).toMatchObject({ droppedRules: [], startUrlBlocked: true });
  });

  it("finds pages blocked for Bingbot alone", () => {
    const facts = robots(
      "User-agent: bingbot\nDisallow: /blog/\n\nUser-agent: *\nDisallow:\n",
    );
    expect(facts).toMatchObject({
      startUrlBlocked: false,
      blockedForBingOnly: [`${ORIGIN}/blog/a`],
    });
  });

  it("knows nothing without the file", () => {
    expect(
      buildBingSiteFacts({
        pages: [],
        startUrl: `${ORIGIN}/`,
        robotsText: null,
      }).robots,
    ).toBeNull();
  });
});

it("flags sitemap URLs that are not canonical, live and indexable", () => {
  const { sitemap } = buildBingSiteFacts({
    startUrl: `${ORIGIN}/`,
    pages: [
      page("/ok", { inSitemap: true }),
      page("/moved", {
        inSitemap: true,
        statusCode: 301,
        redirectUrl: `${ORIGIN}/new`,
      }),
      page("/dup", { inSitemap: true, canonicalUrl: `${ORIGIN}/ok` }),
      page("/self", { inSitemap: true, canonicalUrl: `${ORIGIN}/self` }),
      page("/off-sitemap", { statusCode: 404 }),
    ],
  });
  expect(sitemap).toMatchObject({ checked: 4, problemCount: 2 });
});
