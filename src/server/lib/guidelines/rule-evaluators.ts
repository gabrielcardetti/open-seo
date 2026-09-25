/**
 * Rules settled in TypeScript, before any judge is called.
 *
 * Every rule answered here is a judge call not made and a verdict that cannot
 * drift between runs. The set is deliberately conservative: a rule belongs here
 * only when the page data decides it outright. Anything needing judgement —
 * "is this useful?", "does this read as made for search engines?" — is not a
 * candidate no matter how tempting the heuristic looks, because a wrong
 * deterministic answer is worse than an honest `unknown`.
 *
 * The one exception is the spam signals: they settle nothing, so they only
 * ever warn, with the evidence attached, and otherwise return null.
 */
import type { RuleStatus } from "@/shared/guidelines/catalog";
import type { FetchedPage } from "./page-fetch";
import type { SiteFacts, SiteTripwire } from "./site-facts";

export interface EvaluationContext {
  page: FetchedPage;
  /** Whether any internal link was seen pointing at this URL during the crawl. */
  hasInboundInternalLinks?: boolean;
  /** Site-level facts gathered once per audit. */
  site?: { facts?: SiteFacts };
}

/** The site pass has facts and no page; site rules read nothing else. */
export interface SiteEvaluationContext {
  site: { facts: SiteFacts };
}

interface DeterministicResult {
  status: RuleStatus;
  evidence?: string;
  reason?: string;
}

/** Null leaves the rule unsettled, to be routed as if there were no evaluator. */
type Evaluator = (ctx: EvaluationContext) => DeterministicResult | null;

/**
 * `noindex`, or `none` (noindex + nofollow), as a directive of its own. Matched
 * per directive, not as a word: `max-image-preview:none` contains "none" and
 * says nothing about indexing.
 */
function blocksIndexing(directives: readonly string[]): boolean {
  return directives.some((directive) => {
    const value = directive.trim().toLowerCase();
    return value === "noindex" || value === "none";
  });
}

const directiveList = (value: string | null): string[] =>
  value ? value.split(",") : [];

/**
 * The `X-Robots-Tag` directives that apply to Googlebot.
 *
 * The header can scope a directive to one crawler ("otherbot: noindex"), and
 * several headers arrive joined by commas. A named user agent holds until the
 * next one; directives before any name apply to every crawler.
 */
/** Directives written `name: value`, which are not crawler names. */
const VALUED_DIRECTIVES = new Set([
  "unavailable_after",
  "max-snippet",
  "max-image-preview",
  "max-video-preview",
]);

function headerDirectivesForGooglebot(header: string): string[] {
  const applying: string[] = [];
  let agent: string | null = null;
  for (const part of header.split(",")) {
    const scoped = part.match(/^\s*([a-z][\w-]*)\s*:\s*(.*)$/i);
    let directive = part.trim();
    if (scoped && !VALUED_DIRECTIVES.has(scoped[1].toLowerCase())) {
      agent = scoped[1].toLowerCase();
      directive = scoped[2].trim();
    }
    if (agent === null || agent === "googlebot") applying.push(directive);
  }
  return applying;
}

/** Where a page tells Google not to index it: meta robots, meta googlebot, or the header. */
function noindexSource(page: FetchedPage): string | null {
  if (blocksIndexing(directiveList(page.robotsMeta))) {
    return `meta robots: ${page.robotsMeta}`;
  }
  if (blocksIndexing(directiveList(page.googlebotMeta))) {
    return `meta googlebot: ${page.googlebotMeta}`;
  }
  const header = page.robotsHeader ?? "";
  if (blocksIndexing(headerDirectivesForGooglebot(header))) {
    return `X-Robots-Tag: ${header}`;
  }
  return null;
}

/** A URL without its fragment or trailing slash, for canonical comparison. */
function comparableUrl(url: string, base?: string): string | null {
  try {
    const parsed = new URL(url, base);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Narrows an unknown JSON node to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every `@type` in the page's JSON-LD, flattened across blocks and graphs. */
function schemaTypes(page: FetchedPage): string[] {
  const types: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    const record = node;
    const type = record["@type"];
    if (typeof type === "string") types.push(type);
    else if (Array.isArray(type)) {
      for (const t of type) if (typeof t === "string") types.push(t);
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  for (const block of page.structuredData) walk(block, 0);
  return types;
}

/** First `author` name found anywhere in a JSON-LD tree. */
function authorFromSchema(node: unknown, depth: number): string | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = authorFromSchema(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  const record = node;
  const author = record["author"];
  if (typeof author === "string" && author.trim()) return author.trim();
  if (isRecord(author)) {
    const name = author["name"];
    if (typeof name === "string" && name.trim()) return name.trim();
    const nested = authorFromSchema(author, depth + 1);
    if (nested) return nested;
  }
  for (const value of Object.values(record)) {
    const found = authorFromSchema(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Whether the page names a human author.
 *
 * Looks at JSON-LD first, because that is an explicit claim rather than a
 * guess, then falls back to a byline pattern in the visible text.
 */
function namedAuthor(page: FetchedPage): string | null {
  for (const block of page.structuredData) {
    const found = authorFromSchema(block, 0);
    if (found) return found;
  }
  // "By Jane Doe" / "Por Jane Doe", two or three capitalised words.
  const byline = page.bodyText
    .slice(0, 4000)
    .match(
      /\b(?:[Bb]y|[Pp]or|[Ee]scrito por|[Ww]ritten by)\s+([A-ZÁÉÍÓÚÑ][\p{L}.'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}.'-]+){1,2})/u,
    );
  return byline?.[1] ?? null;
}

/**
 * Author strings that name a machine rather than a person.
 *
 * Matched against the whole byline, not a word inside it: "Claude Monet" and
 * "Ai Weiwei" are people, while a byline that is only "ChatGPT" or "AI Writer"
 * is not.
 */
const MACHINE_AUTHOR =
  /^(?:(?:the\s+)?(?:ai|a\.i\.|artificial intelligence|chatgpt|gpt(?:-?\d[\w.]*)?|claude|gemini|copilot|bot|robot)(?:\s+(?:writer|author|assistant|bot|team))?|(?:written|generated|created) by (?:ai|chatgpt|gpt[\w.-]*|claude|gemini)|ia|redactor ia|inteligencia artificial)$/i;

/** Site rules read only the site facts; undefined when none were gathered. */
type SiteEvaluator = (
  facts: SiteFacts | undefined,
) => DeterministicResult | null;

/**
 * About/contact presence: who runs the site and how to reach them. A crawl cut
 * short at its page limit may simply not have reached them, so absence only
 * fails on a complete crawl.
 */
const evaluateAboutAndContact: SiteEvaluator = (facts) => {
  if (!facts)
    return { status: "unknown", reason: "Site pages were not inspected." };
  const { about, contact } = facts.trust;
  if (about || contact) {
    return {
      status: "pass",
      evidence: [about, contact].filter(Boolean).join(" | "),
    };
  }
  return facts.crawlCompleted
    ? {
        status: "fail",
        reason: "No about or contact page was found on the site.",
      }
    : {
        status: "unknown",
        reason:
          "No about or contact page among the crawled pages, but the crawl stopped at its page limit.",
      };
};

/**
 * A crawl tripwire as a warning, with the page that set it off. Never a pass
 * without one: a title lexicon cannot clear a site of hacked or parasite
 * content, so the rule is then left to its reviewer.
 */
function tripwireWarning(
  facts: SiteFacts | undefined,
  ruleId: SiteTripwire["ruleId"],
  reason: string,
): DeterministicResult | null {
  const hits = facts?.tripwires.filter((hit) => hit.ruleId === ruleId) ?? [];
  if (hits.length === 0) return null;
  return {
    status: "warn",
    evidence: hits
      .map((hit) => `${hit.url} "${hit.title ?? ""}" (${hit.why})`)
      .join(" | ")
      .slice(0, 1000),
    reason,
  };
}

const siteEvaluators: Record<string, SiteEvaluator> = {
  // Trust signals a reader expects to be able to find.
  "EAT-06": evaluateAboutAndContact,

  // UGC spam needs somewhere users can post. Where there is one, whether it
  // is moderated is not something titles and URLs show.
  "SPAM-15": (facts) => {
    if (!facts) return null;
    if (facts.ugcSurfaces.length === 0) return { status: "n/a" };
    return {
      status: "unknown",
      evidence: facts.ugcSurfaces.join(", "),
      reason:
        "The site has user-content pages; whether they are moderated needs a look at them.",
    };
  },

  "SPAM-04": (facts) =>
    tripwireWarning(
      facts,
      "SPAM-04",
      "Titles or URLs look like injected spam; check the site has not been hacked.",
    ),
  "SPAM-12": (facts) =>
    tripwireWarning(
      facts,
      "SPAM-12",
      "A section looks like third-party content outside the site's business; check it is editorially integrated.",
    ),
};

/**
 * A spam signal found in the raw HTML, as a warning.
 *
 * Never `fail`: each signal has legitimate lookalikes, and a raw fetch sees
 * neither external scripts nor stylesheets. Never `pass` either, for the same
 * reason; with nothing found the rule is left to its reviewer, as before.
 */
function spamWarning(
  findings: readonly string[],
  reason: string,
): DeterministicResult | null {
  if (findings.length === 0) return null;
  return { status: "warn", evidence: findings.join(" | "), reason };
}

const evaluators: Record<string, Evaluator> = {
  // Search technical requirements: the page must actually answer.
  "TECH-02": ({ page }) =>
    page.statusCode >= 200 && page.statusCode < 300
      ? { status: "pass" }
      : {
          status: "fail",
          evidence: `HTTP ${page.statusCode}`,
          reason: "The URL does not return a successful response.",
        },

  // Indexable content. Text in the served HTML settles it; an empty shell does
  // not, because Google renders every 200 page and client-side content is
  // indexable once rendered. That half needs the rendered page (TECH-08).
  "TECH-03": ({ page }) =>
    page.wordCount > 0
      ? { status: "pass" }
      : {
          status: "unknown",
          reason:
            "No text in the served HTML; the content is likely rendered with JavaScript, which needs the rendered page to check.",
        },

  "TECH-04": ({ page }) => {
    const source = noindexSource(page);
    return source
      ? {
          status: "fail",
          evidence: source,
          reason: "The page asks search engines not to index it.",
        }
      : { status: "pass" };
  },

  // A self-referencing or absent canonical is settled. One pointing elsewhere
  // is a fact, but whether that target is the right version is not.
  "TECH-05": ({ page }) => {
    if (!page.canonical) return { status: "pass" };
    const target = comparableUrl(page.canonical, page.finalUrl);
    if (target !== null && target === comparableUrl(page.finalUrl)) {
      return { status: "pass" };
    }
    return {
      status: "unknown",
      evidence: page.canonical,
      reason:
        "The canonical points to another URL; whether it is the right version needs a look.",
    };
  },

  // Page experience starts at the transport.
  "PX-01": ({ page }) =>
    page.isHttps
      ? { status: "pass" }
      : {
          status: "fail",
          evidence: page.finalUrl,
          reason: "The page is served over plain HTTP.",
        },

  // Who: a named creator where a reader would ask for one.
  // Without one, whether this kind of page needs a byline is the judge's call.
  "WHO-01": (ctx) => {
    const author = namedAuthor(ctx.page);
    return author ? { status: "pass", evidence: author } : null;
  },

  // Naming a model as the author is called out explicitly by the guidance.
  "EAT-05": (ctx) => {
    const author = namedAuthor(ctx.page);
    if (!author) return { status: "unknown", reason: "No author to check." };
    return MACHINE_AUTHOR.test(author)
      ? {
          status: "fail",
          evidence: author,
          reason: "The byline credits an AI tool instead of a person.",
        }
      : { status: "pass", evidence: author };
  },

  // Spam the raw HTML can show but not prove (see spam-signals.ts).
  "SPAM-05": ({ page }) =>
    spamWarning(
      page.spamSignals.hiddenContent,
      "Content hidden by an inline style looks planted for search engines; check it is not meant for visitors.",
    ),
  "SPAM-08": ({ page }) =>
    spamWarning(
      page.spamSignals.historyTraps,
      "An inline script adds a history entry and sends the Back button somewhere other than the previous page.",
    ),
  "SPAM-13": ({ page }) =>
    spamWarning(
      page.spamSignals.sneakyRedirects,
      "The page sends visitors to another site instantly or depending on who they are.",
    ),

  // Structured data must describe what the page actually shows.
  "SD-01": ({ page }) => {
    const types = schemaTypes(page);
    if (types.length === 0) return { status: "n/a" };
    return {
      status: "unknown",
      reason: "Whether the markup matches the visible content needs judgement.",
    };
  },

  // Review markup on a page carrying no reviews is the clearest schema abuse.
  // With reviews on show, whether they are real or incentivised without saying
  // so is the judge's call.
  "SD-02": ({ page }) => {
    const types = schemaTypes(page);
    const reviewTypes = types.filter((t) =>
      /review|rating|aggregaterating/i.test(t),
    );
    if (reviewTypes.length === 0) return { status: "n/a" };
    const mentionsReviews =
      /(\b(reviews?|reseñas?|opini[oó]n(?:es)?|valoraci[oó]n(?:es)?|ratings?|estrellas?|stars?)\b|★)/i.test(
        page.bodyText,
      );
    return mentionsReviews
      ? null
      : {
          status: "fail",
          evidence: reviewTypes.join(", "),
          reason:
            "The page carries review or rating markup but shows no reviews to a reader.",
        };
  },

  // Orphan pages, from the crawl's own link graph.
  "TECH-07": (ctx) => {
    if (ctx.hasInboundInternalLinks === undefined) {
      return { status: "unknown", reason: "The link graph was not available." };
    }
    return ctx.hasInboundInternalLinks
      ? { status: "pass" }
      : {
          status: "fail",
          reason: "No internal link points at this URL.",
        };
  },

  // On-page basics the crawl already measures.
  "ON-03": ({ page }) => {
    if (page.imagesTotal === 0) return { status: "n/a" };
    const missing = page.imagesMissingAlt;
    if (missing === 0) return { status: "pass" };
    return {
      status: missing === page.imagesTotal ? "fail" : "warn",
      evidence: `${missing} of ${page.imagesTotal} images have no alt text`,
      reason: "Content images should carry descriptive alt text.",
    };
  },
};

/**
 * Run the deterministic evaluator for a rule, if there is one.
 *
 * Returns null when the rule is not settled here, which routes it to a judge.
 * An evaluator that throws is treated as no answer rather than taking the whole
 * page evaluation down with it.
 */
export function evaluateDeterministic(
  ruleId: string,
  ctx: EvaluationContext | SiteEvaluationContext,
): DeterministicResult | null {
  const siteEvaluator = siteEvaluators[ruleId];
  const evaluator = evaluators[ruleId];
  try {
    if (siteEvaluator) return siteEvaluator(ctx.site?.facts);
    if (!evaluator || !("page" in ctx)) return null;
    return evaluator(ctx);
  } catch (error) {
    return {
      status: "unknown",
      reason: `Could not evaluate: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
