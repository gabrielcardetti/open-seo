/**
 * Re-fetches a sampled page to get what the crawl deliberately throws away.
 *
 * The crawler computes body text, hashes it for duplicate detection, and drops
 * it (site-audit-workflow-helpers.ts). Persisting it for every crawled page
 * would put multi-KB strings back on the hot path that specs/0009 spent an
 * architecture rewrite getting off. Since only a sample is evaluated, fetching
 * those few pages again is both cheaper and simpler than changing the crawl.
 *
 * The second thing this recovers is the raw JSON-LD. `audit_pages` stores only
 * `has_structured_data` as a boolean, and the SD-* rules need the actual markup
 * to say anything.
 */
import { isCrawlableUrl } from "../audit/url-policy";

const USER_AGENT = "OpenSEO-Audit/1.0";
const FETCH_TIMEOUT_MS = 15_000;
/** Matches the crawler's cap, for the same memory reason. */
const MAX_HTML_BYTES = 1024 * 1024;
/** JSON-LD blocks past this size are product feeds, not page semantics. */
const MAX_JSONLD_CHARS = 20_000;

export interface FetchedPage {
  url: string;
  finalUrl: string;
  statusCode: number;
  title: string;
  metaDescription: string;
  canonical: string | null;
  robotsMeta: string | null;
  h1s: string[];
  wordCount: number;
  bodyText: string;
  /** Parsed JSON-LD blocks, unusable ones dropped. */
  structuredData: unknown[];
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  isHttps: boolean;
}

async function readTextUpTo(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytesRead = 0;
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytesRead += chunk.byteLength;
      parts.push(decoder.decode(chunk, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parts.join("");
}

/**
 * Pull JSON-LD out of the raw HTML.
 *
 * The streaming analyzer only reports whether structured data exists, so this
 * reads the script blocks directly. A malformed block is skipped rather than
 * failing the page: broken JSON-LD is itself common, and it is SD-03's problem
 * to report, not this function's.
 */
function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (!raw || raw.length > MAX_JSONLD_CHARS) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Unparseable markup: recorded as absent, reported by the schema rules.
    }
  }
  return blocks;
}

class GuidelinesFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "GuidelinesFetchError";
  }
}

/**
 * Fetch and analyze one page for evaluation.
 *
 * The URL goes through the crawler's SSRF policy again even though it came from
 * our own `audit_pages`: a row can outlive a DNS change, and this fetch is
 * issued fresh.
 */
export async function fetchPageForEvaluation(
  url: string,
): Promise<FetchedPage> {
  if (!isCrawlableUrl(url)) {
    throw new GuidelinesFetchError(`URL is not crawlable: ${url}`);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new GuidelinesFetchError(
      `Page returned ${response.status}`,
      response.status,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) {
    await response.body?.cancel();
    throw new GuidelinesFetchError(`Not an HTML document (${contentType})`);
  }

  const html = await readTextUpTo(response, MAX_HTML_BYTES);

  // Loaded lazily for the same reason crawlPage does it: the parser must stay
  // out of the worker's baseline heap (see vite-plugin-lean-worker-bundle).
  const { analyzeHtml } = await import("../audit/page-analyzer");
  const analysis = analyzeHtml(html, response.url || url, response.status, 0);

  return {
    url,
    finalUrl: response.url || url,
    statusCode: response.status,
    title: analysis.title,
    metaDescription: analysis.metaDescription,
    canonical: analysis.canonical,
    robotsMeta: analysis.robotsMeta,
    h1s: analysis.h1s,
    wordCount: analysis.wordCount,
    bodyText: analysis.bodyText,
    structuredData: extractJsonLd(html),
    imagesTotal: analysis.images.length,
    imagesMissingAlt: analysis.images.filter(
      (image) => !image.alt || !image.alt.trim(),
    ).length,
    internalLinks: analysis.links.filter((link) => link.isInternal).length,
    externalLinks: analysis.links.filter((link) => !link.isInternal).length,
    isHttps: (response.url || url).startsWith("https://"),
  };
}
