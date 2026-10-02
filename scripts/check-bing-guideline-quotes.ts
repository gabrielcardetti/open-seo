import process from "node:process";
import { Parser } from "htmlparser2";
import { z } from "zod";
import { GUIDELINE_RULES, SOURCE_DOCUMENTS } from "@/shared/guidelines/catalog";

/**
 * Re-checks every Bing quote in the guideline catalog against the live text
 * of the document it cites.
 *
 * Bing's help pages are a JavaScript app with no date of their own, so a
 * rewrite (like February 2026's) shows up only as quotes that stop matching.
 * Each source document is fetched once from its `fetch_url` (the help API's
 * HTML for Bing's articles), reduced to text, and every quote must appear in
 * it after whitespace (including no-break spaces) is collapsed. Nothing else
 * is normalized: the catalog keeps Bing's typography (U+2011, U+2019).
 *
 * Usage: pnpm check:bing-quotes        Exits 1 when a quote no longer matches.
 */

/** Tags whose boundaries separate words; any other tag joins its text. */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template"]);

const helpArticleSchema = z.object({ HtmlContent: z.string() });

const normalize = (text: string) => text.replace(/[\s ]+/g, " ").trim();

function textOf(html: string): string {
  const parts: string[] = [];
  let skipped = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIPPED_TAGS.has(name)) skipped += 1;
        if (BLOCK_TAGS.has(name)) parts.push(" ");
      },
      ontext(text) {
        if (skipped === 0) parts.push(text);
      },
      onclosetag(name) {
        if (SKIPPED_TAGS.has(name)) skipped -= 1;
        if (BLOCK_TAGS.has(name)) parts.push(" ");
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return normalize(parts.join(""));
}

async function documentText(fetchUrl: string): Promise<string> {
  const response = await fetch(fetchUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenSEO quote check)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  const html = fetchUrl.includes("/webmasters/api/help/htmlcontent")
    ? helpArticleSchema.parse(JSON.parse(body)).HtmlContent
    : body;
  return textOf(html);
}

const quotes = GUIDELINE_RULES.flatMap((rule) =>
  rule.sources
    .filter((source) => source.engine === "bing" && source.official_quote)
    .map((source) => ({ ruleId: rule.id, ...source })),
);

let failures = 0;
for (const [sourceId, document] of Object.entries(SOURCE_DOCUMENTS)) {
  const own = quotes.filter((quote) => quote.source === sourceId);
  if (own.length === 0) continue;
  let text: string;
  try {
    text = await documentText(document.fetch_url);
  } catch (error) {
    failures += own.length;
    console.log(
      `FAIL ${sourceId} could not be read (${error instanceof Error ? error.message : String(error)}): ${document.fetch_url}`,
    );
    continue;
  }
  const missing = own.filter(
    (quote) => !text.includes(normalize(quote.official_quote)),
  );
  failures += missing.length;
  console.log(
    `${missing.length === 0 ? "ok  " : "FAIL"} ${sourceId} (${document.title}, checked ${document.checked}): ${own.length - missing.length}/${own.length} quotes match`,
  );
  for (const quote of missing) {
    console.log(`       - ${quote.ruleId}: "${quote.official_quote}"`);
  }
}

const unlisted = quotes.filter((quote) => !SOURCE_DOCUMENTS[quote.source]);
for (const quote of unlisted) {
  failures += 1;
  console.log(
    `FAIL ${quote.ruleId} cites ${quote.source}, which has no source document`,
  );
}

console.log(
  failures === 0
    ? `\nAll ${quotes.length} Bing quotes match their sources.`
    : `\n${failures} Bing quote(s) no longer match; update the rules and the documents' "checked" date.`,
);
process.exitCode = failures === 0 ? 0 : 1;
