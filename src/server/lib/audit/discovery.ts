/**
 * robots.txt and sitemap.xml discovery for the site audit crawler.
 */
import robotsParser from "robots-parser";
import { XMLParser } from "fast-xml-parser";
import { isSameOrigin, normalizeUrl } from "./url-utils";
import {
  isCrawlableUrl,
  normalizeAndValidateStartUrl,
  resolveStartUrlRedirects,
} from "./url-policy";
import { crawlerHeadersFor, type CrawlerAccess } from "@/shared/crawler-access";

const SITEMAP_FETCH_TIMEOUT_MS = 15_000;
// robots.txt is checkpointed as durable Workflow step state (~1MiB cap, shared
// with the rest of the step's return). RFC 9309 requires parsers to handle at
// least 500 KiB and permits ignoring anything beyond it — Google does exactly
// that — so this cap matches standard crawler behavior while keeping a
// misbehaving server (e.g. HTML at /robots.txt) from blowing the step limit.
const MAX_ROBOTS_TXT_BYTES = 500 * 1024;
const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAP_DOCS = 300;
const SITEMAP_CONCURRENCY = 5;
const SITEMAP_RETRIES = 1;
// Sitemap shards can legally reach 50 MB and SITEMAP_CONCURRENCY of them are
// read at once, so unbounded reads can exhaust Worker memory. Oversized
// shards are skipped whole — truncated XML would not parse anyway, and real
// generators shard far below this.
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => name === "sitemap" || name === "url",
});

export interface RobotsResult {
  isAllowed: (url: string) => boolean;
  sitemapUrls: string[];
}

/**
 * Fetch the raw robots.txt body (null = missing/unreachable). Kept separate
 * from parsing so Workflows can checkpoint the text as durable step state and
 * re-derive the parsed result deterministically on replay.
 */
export async function fetchRobotsTxtText(
  origin: string,
  access?: CrawlerAccess | null,
): Promise<string | null> {
  try {
    const fetched = await fetchFollowingRedirects(
      `${origin}/robots.txt`,
      10_000,
      access,
    );
    if (!fetched?.response.ok) return null;
    return (await fetched.response.text()).slice(0, MAX_ROBOTS_TXT_BYTES);
  } catch (error) {
    console.warn("Failed to fetch robots.txt:", error);
    return null;
  }
}

const MAX_DISCOVERY_REDIRECT_HOPS = 5;

/**
 * Redirects are followed by hand so each hop is revalidated against the crawl
 * policy and crawler-access headers — bot-protection credentials — are
 * re-matched against the hop's host instead of riding along to another site.
 */
async function fetchFollowingRedirects(
  url: string,
  timeoutMs: number,
  access: CrawlerAccess | null | undefined,
): Promise<{ response: Response; finalUrl: string } | null> {
  // One budget for the whole chain, as the automatic follow had.
  const deadline = Date.now() + timeoutMs;
  let current = url;
  for (let hop = 0; hop <= MAX_DISCOVERY_REDIRECT_HOPS; hop++) {
    const response = await fetch(current, {
      headers: {
        "User-Agent": "OpenSEO-Audit/1.0",
        ...crawlerHeadersFor(current, access),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: current };
    }

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return null;

    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      return null;
    }
    if (!isCrawlableUrl(next)) return null;
    current = next;
  }
  return null;
}

/** Deterministic: same text in, same result out. Null = everything allowed. */
export function parseRobotsTxt(
  origin: string,
  text: string | null,
): RobotsResult {
  if (text === null) {
    return { isAllowed: () => true, sitemapUrls: [] };
  }

  const robots = robotsParser(`${origin}/robots.txt`, text);
  return {
    isAllowed: (url: string) => robots.isAllowed(url) ?? true,
    sitemapUrls: robots.getSitemaps(),
  };
}

/**
 * Fetch and parse a sitemap (supports sitemap index recursion).
 * Returns a flat list of page URLs found.
 */
function isProbablySitemapXml(
  contentType: string | null,
  body: string,
): boolean {
  if (contentType?.toLowerCase().includes("xml")) {
    return true;
  }

  const trimmed = body.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<urlset") ||
    trimmed.startsWith("<sitemapindex")
  );
}

/** A sitemap `<url>` (or `<sitemap>`) entry: its `<loc>` and `<lastmod>`. */
interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

function getSitemapEntries(input: unknown): SitemapEntry[] {
  if (!input) return [];
  const entries = Array.isArray(input) ? input : [input];
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const loc = entry["loc"];
    if (typeof loc !== "string") return [];
    const lastmod = entry["lastmod"];
    return [
      {
        url: loc,
        // The XML parser turns a bare year into a number.
        lastmod:
          typeof lastmod === "string" || typeof lastmod === "number"
            ? String(lastmod).trim() || null
            : null,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function getParsedSitemapSections(parsed: unknown): {
  sitemap: unknown;
  url: unknown;
} {
  if (!parsed || typeof parsed !== "object") {
    return { sitemap: undefined, url: undefined };
  }

  const root = parsed as {
    sitemapindex?: { sitemap?: unknown };
    urlset?: { url?: unknown };
  };

  return {
    sitemap: root.sitemapindex?.sitemap,
    url: root.urlset?.url,
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "name" in error && error.name === "TimeoutError";
}

/** Read a response body up to maxBytes; null when the body exceeds it. */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** Answers that say the server could not serve the file right now. */
const isTransientStatus = (status: number) => status === 429 || status >= 500;

/**
 * One sitemap document's page entries and nested sitemaps. `failed` marks a
 * read that may succeed next time (network error, timeout, 429, 5xx); a
 * missing or malformed document is a stable answer, not a failure.
 */
async function fetchSitemapDocumentWithRetry(
  sitemapUrl: string,
  access?: CrawlerAccess | null,
): Promise<{
  nestedSitemaps: string[];
  pageEntries: SitemapEntry[];
  timedOut: boolean;
  failed: boolean;
}> {
  const empty = {
    nestedSitemaps: [],
    pageEntries: [],
    timedOut: false,
    failed: false,
  };
  const normalizedSitemapUrl = normalizeUrl(sitemapUrl);
  if (!normalizedSitemapUrl) {
    return empty;
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= SITEMAP_RETRIES; attempt++) {
    let finalUrl: string;
    let body: string;
    try {
      const fetched = await fetchFollowingRedirects(
        normalizedSitemapUrl,
        SITEMAP_FETCH_TIMEOUT_MS,
        access,
      );
      if (!fetched) {
        return empty;
      }
      const { response } = fetched;

      const resolvedUrl = normalizeUrl(fetched.finalUrl, normalizedSitemapUrl);
      if (!resolvedUrl || !isSameOrigin(resolvedUrl, normalizedSitemapUrl)) {
        await response.body?.cancel();
        return empty;
      }
      finalUrl = resolvedUrl;

      if (!response.ok) {
        await response.body?.cancel();
        return { ...empty, failed: isTransientStatus(response.status) };
      }

      const text = await readBodyCapped(response, MAX_SITEMAP_BYTES);
      if (
        text === null ||
        !isProbablySitemapXml(response.headers.get("content-type"), text)
      ) {
        return empty;
      }
      body = text;
    } catch (error) {
      lastError = error;
      if (!isTimeoutError(error) || attempt === SITEMAP_RETRIES) {
        break;
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = xmlParser.parse(body);
    } catch {
      return empty;
    }
    const sections = getParsedSitemapSections(parsed);
    const nestedSitemaps = getSitemapEntries(sections.sitemap)
      .map((entry) => normalizeUrl(entry.url, finalUrl))
      .filter((loc): loc is string => loc !== null);
    const pageEntries = getSitemapEntries(sections.url).flatMap((entry) => {
      const url = normalizeUrl(entry.url, finalUrl);
      return url ? [{ url, lastmod: entry.lastmod }] : [];
    });

    return { nestedSitemaps, pageEntries, timedOut: false, failed: false };
  }

  return { ...empty, timedOut: isTimeoutError(lastError), failed: true };
}

type SitemapWalk = {
  /** Page URL to its `<lastmod>`, in sitemap order. */
  urls: Map<string, string | null>;
  /** A URL or document cap stopped the walk before every sitemap was read. */
  truncated: boolean;
  /** Documents that could not be read this time (timeout, network, 429, 5xx). */
  failedSitemaps: string[];
};

/**
 * Walk the given sitemaps (and the sitemap indexes they lead to) and collect
 * up to `maxUrls` same-origin page URLs with their lastmod, in sitemap order:
 * documents are read a few at a time but merged in queue order, so the same
 * sitemaps always give the same URLs at the cap. Bounded by depth and
 * document count as well.
 */
async function walkSitemaps(
  origin: string,
  sitemapSources: Iterable<string>,
  maxUrls: number,
  access?: CrawlerAccess | null,
): Promise<SitemapWalk> {
  const allUrls = new Map<string, string | null>();

  const queue: Array<{ url: string; depth: number }> = Array.from(
    sitemapSources,
  )
    .map((url) => normalizeUrl(url, origin))
    .filter((url): url is string => url !== null)
    .filter((url) => isSameOrigin(url, origin))
    .map((url) => ({ url, depth: MAX_SITEMAP_DEPTH }));
  const seenSitemapDocs = new Set<string>();
  /** The entry as a document to read; null for a repeat or too deep. */
  const unreadDoc = (item: { url: string; depth: number }) => {
    const normalizedUrl = normalizeUrl(item.url);
    if (
      !normalizedUrl ||
      !isSameOrigin(normalizedUrl, origin) ||
      item.depth <= 0 ||
      seenSitemapDocs.has(normalizedUrl)
    ) {
      return null;
    }
    return { url: normalizedUrl, depth: item.depth };
  };
  let fetchedDocs = 0;
  let failedDocs = 0;
  let timedOutDocs = 0;
  let truncated = false;
  const failedSitemaps: string[] = [];

  while (
    queue.length > 0 &&
    allUrls.size < maxUrls &&
    fetchedDocs < MAX_SITEMAP_DOCS
  ) {
    const batch: Array<{ url: string; depth: number }> = [];
    for (const item of queue.splice(0, SITEMAP_CONCURRENCY)) {
      const doc = unreadDoc(item);
      if (!doc) continue;
      seenSitemapDocs.add(doc.url);
      batch.push(doc);
    }
    fetchedDocs += batch.length;

    const results = await Promise.all(
      batch.map(async (doc) => ({
        ...doc,
        result: await fetchSitemapDocumentWithRetry(doc.url, access),
      })),
    );

    for (const { url, depth, result } of results) {
      if (result.failed) failedSitemaps.push(url);
      if (
        result.pageEntries.length === 0 &&
        result.nestedSitemaps.length === 0
      ) {
        failedDocs += 1;
        if (result.timedOut) {
          timedOutDocs += 1;
        }
        continue;
      }

      for (const entry of result.pageEntries) {
        if (!isSameOrigin(entry.url, origin) || allUrls.has(entry.url)) {
          continue;
        }
        if (allUrls.size >= maxUrls) {
          truncated = true;
          break;
        }
        allUrls.set(entry.url, entry.lastmod);
      }

      if (depth <= 1) continue;

      for (const nestedUrl of result.nestedSitemaps) {
        if (!isSameOrigin(nestedUrl, origin)) continue;
        if (!seenSitemapDocs.has(nestedUrl)) {
          queue.push({ url: nestedUrl, depth: depth - 1 });
        }
      }
    }
  }
  // Documents left unread because a cap stopped the walk.
  if (queue.some((item) => unreadDoc(item) !== null)) truncated = true;

  if (failedDocs > 0) {
    console.warn(
      `Sitemap discovery completed with partial failures for ${origin}: fetched=${fetchedDocs}, failed=${failedDocs}, timedOut=${timedOutDocs}, discoveredUrls=${allUrls.size}`,
    );
  }
  return { urls: allUrls, truncated, failedSitemaps };
}

/** Sitemaps named in robots.txt, plus the default /sitemap.xml. */
function sitemapSourcesFor(origin: string, robots: RobotsResult): Set<string> {
  const sources = new Set(robots.sitemapUrls);
  sources.add(`${origin}/sitemap.xml`);
  return sources;
}

/**
 * Discover all page URLs from robots.txt + sitemaps for an origin.
 * Also tries the default /sitemap.xml if not listed in robots.txt.
 */
export async function discoverUrls(
  origin: string,
  maxPages = 50,
  access?: CrawlerAccess | null,
): Promise<{ urls: string[]; robotsText: string | null }> {
  const robotsText = await fetchRobotsTxtText(origin, access);
  const robots = parseRobotsTxt(origin, robotsText);

  const maxDiscoveredUrls = Math.min(Math.max(maxPages * 20, 500), 50_000);
  const { urls: allUrls } = await walkSitemaps(
    origin,
    sitemapSourcesFor(origin, robots),
    maxDiscoveredUrls,
    access,
  );

  // Cap at the crawl's page budget: these are seeds, the crawl can never use
  // more — and an uncapped list can blow the ~1MiB Workflow step-state limit.
  return {
    urls: Array.from(allUrls.keys()).slice(0, maxPages),
    robotsText,
  };
}

/** Upper bound on one site's sitemap inventory. */
const MAX_INVENTORY_URLS = 50_000;

/**
 * Every page URL a site's sitemaps list, with its `<lastmod>`, for the
 * indexing inventory. Unlike `discoverUrls` there is no crawl budget, only
 * the walk's own depth, document and URL bounds. The site is resolved first
 * (validated, redirects followed) so an apex domain that redirects to www
 * reads the www sitemaps. `truncated` says a cap cut the walk short (the same
 * sitemaps are always cut at the same place); `failedSitemaps` lists the
 * documents that could not be read this time, whose URLs are missing from
 * `entries`.
 */
export async function collectSitemapEntries(domain: string): Promise<{
  origin: string;
  entries: SitemapEntry[];
  truncated: boolean;
  failedSitemaps: string[];
}> {
  const startUrl = await normalizeAndValidateStartUrl(domain);
  const { url } = await resolveStartUrlRedirects(startUrl);
  const origin = new URL(url).origin;
  const robots = parseRobotsTxt(origin, await fetchRobotsTxtText(origin));
  const walk = await walkSitemaps(
    origin,
    sitemapSourcesFor(origin, robots),
    MAX_INVENTORY_URLS,
  );
  return {
    origin,
    entries: Array.from(walk.urls, ([pageUrl, lastmod]) => ({
      url: pageUrl,
      lastmod,
    })),
    truncated: walk.truncated,
    failedSitemaps: walk.failedSitemaps,
  };
}
