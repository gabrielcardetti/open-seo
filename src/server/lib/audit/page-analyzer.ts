/**
 * HTML page analyzer using htmlparser2's streaming tokenizer.
 *
 * Extracts SEO-relevant data from a page's HTML: title, meta description,
 * headings, images, links, canonical, OG tags, structured data, robots meta,
 * word count, hreflang, JSON-LD blocks, insecure subresources.
 *
 * Deliberately NOT a DOM parser: the previous cheerio implementation built a
 * full DOM (~5-10x the HTML's size) per page, and with 25 concurrent parses
 * on a 128MB isolate that was the audit engine's dominant OOM cause. The
 * tokenizer keeps only the accumulated text and extracted fields in memory.
 */
import { Parser } from "htmlparser2";
import { normalizeUrl, isSameOrigin } from "./url-utils";
import type { PageAnalysis, PageLink } from "./types";

const SKIPPED_LINK_PROTOCOLS = /^(javascript:|mailto:|tel:|#)/;
/** Subtrees whose text is not visible content. */
const NON_CONTENT_TAGS = new Set(["script", "style", "noscript", "svg"]);
const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};
const MAX_ANCHOR_CHARS = 200;
/**
 * Per-page caps on the extracted collections. Crawler-trap and mega-menu
 * pages can carry thousands of links/images per page, and crawled pages sit
 * in memory in 25-page persist batches — uncapped collections were part of
 * the audit engine's exceededMemory profile. Counts derived from these
 * arrays saturate at the cap on such pathological pages.
 */
const MAX_EXTRACTED_LINKS = 1_000;
const MAX_EXTRACTED_IMAGES = 1_000;
const MAX_EXTRACTED_HREFLANG = 200;
const MAX_HREF_CHARS = 2_048;
/** JSON-LD text kept per page; real markup is a few KB. */
const MAX_JSON_LD_CHARS = 200_000;
const MAX_INSECURE_SAMPLES = 10;
const MAX_H1_CHARS = 300;
/** Elements whose `src` loads a subresource into the page. */
const SUBRESOURCE_SRC_TAGS = new Set([
  "img",
  "script",
  "iframe",
  "video",
  "audio",
  "source",
  "embed",
]);

interface OpenAnchor {
  href: string;
  rel: string;
  text: string[];
}

/**
 * Analyze an HTML string and extract all SEO-relevant data.
 */
export function analyzeHtml(
  html: string,
  pageUrl: string,
  statusCode: number,
  responseTimeMs: number,
  redirectUrl: string | null = null,
): PageAnalysis {
  let title: string | null = null;
  let titleDepth = 0;
  let titleDone = false;
  // parse5 (the old DOM path) treats <noscript> content as raw text when
  // scripting is enabled; skip element extraction inside it to match.
  let noscriptDepth = 0;
  let metaDescription: string | null = null;
  let canonical: string | null = null;
  let robotsMeta: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;
  let hasStructuredData = false;
  const jsonLdBlocks: string[] = [];
  let openJsonLd: string[] | null = null;
  let jsonLdChars = 0;
  const hreflangLinks: Array<{ hreflang: string; href: string }> = [];
  const insecureSubresources: string[] = [];
  let insecureSubresourceCount = 0;

  const h1s: string[] = [];
  const headingOrder: number[] = [];
  let openH1: string[] | null = null;

  const images: PageAnalysis["images"] = [];
  const linksByTarget = new Map<string, PageLink>();
  let openAnchor: OpenAnchor | null = null;

  // Visible text: prefer text inside an explicit <body>; when the document
  // never opens one (fragments), fall back to all non-head text. Both
  // exclude NON_CONTENT_TAGS subtrees.
  let suppressDepth = 0;
  let bodyDepth = 0;
  let headDepth = 0;
  let sawBody = false;
  const bodyParts: string[] = [];
  const fallbackParts: string[] = [];

  const handleMetaTag = (attribs: Record<string, string>) => {
    const content = attribs["content"];
    if (attribs["name"] === "description") {
      metaDescription ??= content?.trim() ?? "";
    } else if (attribs["name"] === "robots") {
      robotsMeta ??= content ?? null;
    } else if (attribs["property"] === "og:title") {
      ogTitle ??= content ?? null;
    } else if (attribs["property"] === "og:description") {
      ogDescription ??= content ?? null;
    } else if (attribs["property"] === "og:image") {
      ogImage ??= content ?? null;
    }
  };

  const handleLinkTag = (attribs: Record<string, string>) => {
    const rel = attribs["rel"]?.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes("canonical")) {
      canonical ??= attribs["href"] ?? null;
    } else if (
      rel.includes("alternate") &&
      attribs["hreflang"] &&
      attribs["href"] &&
      hreflangLinks.length < MAX_EXTRACTED_HREFLANG
    ) {
      const href = normalizeUrl(attribs["href"], pageUrl);
      if (href && href.length <= MAX_HREF_CHARS) {
        hreflangLinks.push({ hreflang: attribs["hreflang"].trim(), href });
      }
    }
    if (rel.includes("stylesheet") || rel.includes("preload")) {
      noteSubresource(attribs["href"]);
    }
  };

  const noteSubresource = (url: string | undefined) => {
    if (!url || !/^http:\/\//i.test(url.trim())) return;
    insecureSubresourceCount += 1;
    if (insecureSubresources.length < MAX_INSECURE_SAMPLES) {
      insecureSubresources.push(url.trim().slice(0, MAX_HREF_CHARS));
    }
  };

  const closeAnchor = () => {
    if (!openAnchor) return;
    const { href, rel, text } = openAnchor;
    openAnchor = null;
    if (linksByTarget.size >= MAX_EXTRACTED_LINKS) return;
    const resolved = normalizeUrl(href, pageUrl);
    if (!resolved || linksByTarget.has(resolved)) return;
    const anchor = text
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_ANCHOR_CHARS);
    linksByTarget.set(resolved, {
      targetUrl: resolved,
      anchor: anchor || null,
      isInternal: isSameOrigin(resolved, pageUrl),
      isNofollow: rel.split(/\s+/).includes("nofollow"),
    });
  };

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (NON_CONTENT_TAGS.has(name)) {
          suppressDepth += 1;
        }
        if (name === "noscript") noscriptDepth += 1;
        if (noscriptDepth > 0) return;
        switch (name) {
          case "title":
            // Ignore <title> inside <svg> — only the document title counts.
            if (!titleDone && suppressDepth === 0) {
              titleDepth += 1;
              if (title === null) title = "";
            }
            break;
          case "head":
            headDepth += 1;
            break;
          case "body":
            bodyDepth += 1;
            sawBody = true;
            break;
          case "meta":
            handleMetaTag(attribs);
            break;
          case "link":
            handleLinkTag(attribs);
            break;
          case "img":
            if (images.length < MAX_EXTRACTED_IMAGES) {
              images.push({
                src: attribs["src"] ?? null,
                alt: "alt" in attribs ? attribs["alt"] : null,
                hasDimensions: "width" in attribs && "height" in attribs,
                lazy: attribs["loading"]?.toLowerCase() === "lazy",
              });
            }
            break;
          case "script":
            if (attribs["type"]?.toLowerCase() === "application/ld+json") {
              hasStructuredData = true;
              openJsonLd = [];
            }
            break;
          case "a": {
            // HTML forbids nested <a>; browsers implicitly close the open
            // one, and the tokenizer has no tree correction, so mirror that.
            closeAnchor();
            const href = attribs["href"];
            if (href && !SKIPPED_LINK_PROTOCOLS.test(href)) {
              openAnchor = {
                href,
                rel: attribs["rel"]?.toLowerCase() ?? "",
                text: [],
              };
            }
            break;
          }
        }
        if (SUBRESOURCE_SRC_TAGS.has(name)) noteSubresource(attribs["src"]);
        const headingLevel = HEADING_LEVELS[name];
        if (headingLevel !== undefined) {
          headingOrder.push(headingLevel);
          if (headingLevel === 1 && openH1 === null) openH1 = [];
        }
      },
      ontext(text) {
        if (openJsonLd && jsonLdChars < MAX_JSON_LD_CHARS) {
          openJsonLd.push(text);
          jsonLdChars += text.length;
        }
        if (suppressDepth > 0) return;
        if (titleDepth > 0) {
          if (title !== null) title += text;
          return;
        }
        if (openH1) openH1.push(text);
        if (openAnchor) openAnchor.text.push(text);
        if (bodyDepth > 0) {
          bodyParts.push(text);
        } else if (headDepth === 0) {
          fallbackParts.push(text);
        }
      },
      onclosetag(name) {
        if (name === "script" && openJsonLd) {
          if (jsonLdChars <= MAX_JSON_LD_CHARS) {
            jsonLdBlocks.push(openJsonLd.join(""));
          }
          openJsonLd = null;
        }
        if (NON_CONTENT_TAGS.has(name) && suppressDepth > 0) {
          suppressDepth -= 1;
        }
        if (name === "noscript" && noscriptDepth > 0) {
          noscriptDepth -= 1;
          return;
        }
        if (noscriptDepth > 0) return;
        if (name === "title" && titleDepth > 0) {
          titleDepth -= 1;
          if (titleDepth === 0) titleDone = true;
        }
        if (name === "head" && headDepth > 0) headDepth -= 1;
        if (name === "body" && bodyDepth > 0) bodyDepth -= 1;
        if (name === "a") closeAnchor();
        if (name === "h1" && openH1) {
          h1s.push(openH1.join("").trim());
          openH1 = null;
        }
      },
    },
    // Defaults (non-XML mode): lowercased tag/attribute names, decoded
    // entities — matching what the DOM-based implementation saw.
  );
  parser.write(html);
  parser.end();

  const rawText = (sawBody ? bodyParts : fallbackParts).join("");
  const bodyText = rawText.replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  return {
    url: pageUrl,
    statusCode,
    redirectUrl,
    responseTimeMs,
    title: (title ?? "").trim(),
    metaDescription: metaDescription ?? "",
    canonical,
    robotsMeta,
    ogTitle,
    ogDescription,
    ogImage,
    h1s,
    h1Text:
      h1s
        .find((h1) => h1.length > 0)
        ?.replace(/\s+/g, " ")
        .slice(0, MAX_H1_CHARS) ?? null,
    headingOrder,
    wordCount,
    bodyText,
    images,
    links: Array.from(linksByTarget.values()),
    hasStructuredData,
    jsonLdBlocks,
    hreflangLinks,
    insecureSubresources,
    insecureSubresourceCount,
  };
}
