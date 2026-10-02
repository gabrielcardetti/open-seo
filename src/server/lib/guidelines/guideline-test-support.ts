import type { FetchedPage } from "./page-fetch";
import { emptySpamSignals } from "./spam-signals";

/** A fetched page with nothing notable on it; tests override what they assert on. */
export function fetchedPageFixture(
  overrides: Partial<FetchedPage> = {},
): FetchedPage {
  return {
    url: "https://example.com/a",
    finalUrl: "https://example.com/a",
    statusCode: 200,
    title: "A page",
    metaDescription: "",
    canonical: null,
    robotsMeta: null,
    googlebotMeta: null,
    bingbotMeta: null,
    robotsHeader: null,
    h1s: [],
    headingOrder: [],
    wordCount: 300,
    bodyText: "Some content.",
    structuredData: [],
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
    pdfLinks: 0,
    dataNosnippet: 0,
    collapsedWords: 0,
    isHttps: true,
    spamSignals: emptySpamSignals(),
    ...overrides,
  };
}
