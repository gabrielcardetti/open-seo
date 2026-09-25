/**
 * Spam signals that one raw fetch can see, with no JavaScript executed.
 *
 * What a raw fetch sees is narrow: inline scripts (not the external bundles
 * where ad and widget code lives), inline styles (not stylesheets), and one
 * response to one user agent (not what Googlebot or a phone would get). So
 * these findings are evidence for a warning, never proof either way. Finding
 * nothing does not clear a page, and finding something does not fail it: each
 * signal has legitimate lookalikes ("disable Back after payment", a meta
 * refresh left over from a domain move, a hidden partner-links footer).
 *
 * Kept apart from page-fetch.ts because it runs its own htmlparser2 pass
 * (spam-html-scan.ts), which must stay behind a dynamic import (see
 * vite-plugin-lean-worker-bundle).
 */
import {
  parseRefresh,
  registrableDomain,
  scanHtml,
  type HiddenBlock,
  type Refresh,
  type Scan,
} from "./spam-html-scan";

export interface SpamSignals {
  /** SPAM-08: inline scripts that trap the Back button. */
  historyTraps: string[];
  /** SPAM-13: redirects to another site that look conditional or instant. */
  sneakyRedirects: string[];
  /** SPAM-05: inline-style hidden blocks carrying link farms or stuffed text. */
  hiddenContent: string[];
  /** SPAM-17: facts for the judge to weigh; never a verdict on their own. */
  scamFacts: string[];
}

export function emptySpamSignals(): SpamSignals {
  return {
    historyTraps: [],
    sneakyRedirects: [],
    hiddenContent: [],
    scamFacts: [],
  };
}

interface SpamSignalInput {
  html: string;
  finalUrl: string;
  /** Visible text, as page-analyzer extracted it. */
  bodyText: string;
  /** The `Refresh` response header, which fetch does not follow. */
  refreshHeader: string | null;
}

/** Findings kept per signal: enough to act on, small enough to store. */
const MAX_FINDINGS = 3;

export function detectSpamSignals(input: SpamSignalInput): SpamSignals {
  const scan = scanHtml(input.html, input.finalUrl);
  const refreshes = input.refreshHeader
    ? [...scan.metaRefreshes, parseRefresh(input.refreshHeader, "header")]
    : scan.metaRefreshes;
  return {
    historyTraps: findHistoryTraps(scan.inlineScripts).slice(0, MAX_FINDINGS),
    sneakyRedirects: [
      ...findRefreshRedirects(refreshes, scan),
      ...findScriptRedirects(scan.inlineScripts, scan.siteDomain),
    ].slice(0, MAX_FINDINGS),
    hiddenContent: scan.hiddenBlocks
      .flatMap((block) => describeSuspiciousBlock(block, scan.siteDomain))
      .slice(0, MAX_FINDINGS),
    scamFacts: findScamFacts(scan, input.bodyText).slice(0, MAX_FINDINGS),
  };
}

const oneLine = (text: string, max: number) =>
  text.replace(/\s+/g, " ").trim().slice(0, max);

// ---------------------------------------------------------------------------
// SPAM-08: back button hijacking
// ---------------------------------------------------------------------------

/** A call, so `history.pushState = wrapper` (analytics patching) does not count. */
const PUSH_STATE =
  /\bhistory\s*(?:\.\s*pushState|\[\s*['"]pushState['"]\s*\])\s*\(/;
const PUSH_STATE_LOOP =
  /\b(?:for|while)\s*\([^)]{0,80}\)\s*\{?\s*(?:window\s*\.\s*)?history\s*\.\s*pushState\s*\(/;
const HASH_SEED = /\blocation\s*\.\s*hash\s*=(?!=)/;
const POPSTATE_HANDLER =
  /\bonpopstate\s*=(?!=)|addEventListener\s*\(\s*['"]popstate['"]/g;
const HASHCHANGE_HANDLER =
  /\bonhashchange\s*=(?!=)|addEventListener\s*\(\s*['"]hashchange['"]/g;
/** Inside a Back handler: leaving the page, or pushing the visitor forward again. */
const HANDLER_ESCAPES =
  /\blocation\s*(?:\.\s*href\s*)?=(?!=)|\blocation\s*\.\s*(?:replace|assign)\s*\(|\bhistory\s*\.\s*(?:forward\s*\(|go\s*\(\s*1\s*\)|pushState\s*\()|\bwindow\s*\.\s*open\s*\(/;

/**
 * The handler's own body: from the first `{` after its registration to the
 * matching `}`, skipping braces inside strings. Only the body counts, because
 * an unrelated outbound click handler a few lines later is not the Back
 * handler navigating. Named handlers (`addEventListener("popstate", onBack)`)
 * are not followed; that is a known miss.
 */
function handlerBody(code: string, from: number): string {
  const end = Math.min(code.length, from + 4000);
  let start = from;
  while (start < end && !"{;\n".includes(code[start])) start += 1;
  if (code[start] !== "{") return code.slice(from, Math.min(end, from + 200));
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < end; i += 1) {
    const char = code[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}" && --depth === 0) {
      return code.slice(start, i + 1);
    }
  }
  return code.slice(start, end);
}

/**
 * A history entry seeded on load plus a Back handler that navigates or
 * re-traps, or history stuffed in a loop. `replaceState` is ignored: it cannot
 * add entries, and URL cleaners (UTM strippers, Cloudflare tokens) use it.
 * SPA routers pass because their code is in external bundles and their
 * `popstate` handlers re-render rather than navigate.
 */
function findHistoryTraps(scripts: readonly string[]): string[] {
  const findings: string[] = [];
  for (const code of scripts) {
    const loop = PUSH_STATE_LOOP.exec(code);
    if (loop) {
      findings.push(
        `Inline script adds history entries in a loop: ${oneLine(code.slice(loop.index, loop.index + 160), 160)}`,
      );
      continue;
    }
    const handlers: Array<[RegExp, boolean, string]> = [
      [POPSTATE_HANDLER, PUSH_STATE.test(code), "popstate"],
      [HASHCHANGE_HANDLER, HASH_SEED.test(code), "hashchange"],
    ];
    for (const [pattern, seeded, event] of handlers) {
      if (!seeded) continue;
      const trap = [...code.matchAll(pattern)]
        .map((match) => handlerBody(code, match.index + match[0].length))
        .find((body) => HANDLER_ESCAPES.test(body));
      if (trap) {
        findings.push(
          `Inline script adds a history entry and its ${event} handler navigates: ${oneLine(trap, 200)}`,
        );
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// SPAM-13: sneaky redirects
// ---------------------------------------------------------------------------

/**
 * Past this delay a refresh is a "you are leaving" interstitial the visitor
 * can read, not a redirect they are slipped through.
 */
const MAX_SNEAKY_REFRESH_SECONDS = 5;

/**
 * An instant refresh to another registrable domain. One inside `<noscript>`
 * is a no-JS fallback, and `m.` or `www.` hosts share the site's domain.
 */
function findRefreshRedirects(
  refreshes: readonly Refresh[],
  { pageUrl, siteDomain }: Scan,
): string[] {
  const findings: string[] = [];
  for (const refresh of refreshes) {
    if (
      !refresh.url ||
      refresh.inNoscript ||
      refresh.delay > MAX_SNEAKY_REFRESH_SECONDS
    ) {
      continue;
    }
    const target = registrableDomain(refresh.url, pageUrl);
    if (target && target !== siteDomain) {
      const via = refresh.source === "meta" ? "Meta refresh" : "Refresh header";
      findings.push(
        `${via} after ${refresh.delay}s to another site: ${refresh.url}`,
      );
    }
  }
  return findings;
}

const JS_NAVIGATION_TO_LITERAL =
  /\blocation(?:\s*\.\s*href)?\s*=(?!=)\s*(['"`])((?:https?:)?\/\/[^'"`\s]+)\1|\blocation\s*\.\s*(?:replace|assign)\s*\(\s*(['"`])((?:https?:)?\/\/[^'"`\s]+)\3/g;
const REFERRER_CONDITION =
  /document\s*\.\s*referrer[\s\S]{0,200}?(?:google|bing|yahoo|yandex|duckduckgo|baidu)|(?:google|bing|yahoo|yandex|baidu)[\s\S]{0,200}?document\s*\.\s*referrer/i;
const USER_AGENT_CONDITION =
  /navigator\s*\.\s*userAgent[\s\S]{0,300}?(?:android|iphone|ipad|mobile|bot|crawl|spider|googlebot)|(?:android|iphone|ipad|mobi|googlebot)[\s\S]{0,300}?navigator\s*\.\s*userAgent/i;
/** A navigation the visitor asked for by clicking is not a redirect. */
const USER_ACTION =
  /addEventListener\s*\(\s*['"](?:click|submit|touch\w*|mousedown|pointerdown)|\bon(?:click|submit|touchstart|mousedown)\s*=|\.(?:on|click)\s*\(/;
const FUNCTION_WRAP =
  /\bfunction\b|=>|addEventListener|\bonclick\b|\bonsubmit\b|setTimeout|\.on\(/;
/** Smart-app banners send phones to the app stores (apps.apple.com, play.google.com). */
const APP_STORE_DOMAINS = new Set([
  "apple.com",
  "google.com",
  "microsoft.com",
  "amazon.com",
]);
/** How far before a navigation its condition is looked for. */
const CONDITION_WINDOW_CHARS = 400;

/**
 * Inline JS that sends the visitor to another site depending on where they
 * came from or what device they use (the hacked-site and mobile-spam
 * signatures), or unconditionally from a tiny top-level script. A navigation
 * inside a click handler (checkout, OAuth, outbound buttons) is not counted.
 */
function findScriptRedirects(
  scripts: readonly string[],
  siteDomain: string | null,
): string[] {
  const findings: string[] = [];
  for (const code of scripts) {
    for (const match of code.matchAll(JS_NAVIGATION_TO_LITERAL)) {
      const target = match[2] ?? match[4];
      const domain = registrableDomain(
        target.startsWith("//") ? `https:${target}` : target,
      );
      if (!domain || domain === siteDomain || APP_STORE_DOMAINS.has(domain)) {
        continue;
      }
      const before = code.slice(
        Math.max(0, match.index - CONDITION_WINDOW_CHARS),
        match.index,
      );
      const condition =
        REFERRER_CONDITION.exec(before) ?? USER_AGENT_CONDITION.exec(before);
      let kind: string | null = null;
      if (condition) {
        const between = before.slice(condition.index);
        if (!USER_ACTION.test(between)) {
          kind = condition[0].toLowerCase().includes("referrer")
            ? "search visitors"
            : "some devices or bots";
        }
      } else if (
        code.replace(/\s+/g, "").length < 400 &&
        !FUNCTION_WRAP.test(code)
      ) {
        kind = "every visitor";
      }
      if (kind) {
        findings.push(
          `Inline script sends ${kind} to another site: ${oneLine(code.slice(Math.max(0, match.index - 120), match.index + match[0].length), 240)}`,
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// SPAM-05: hidden text and links
// ---------------------------------------------------------------------------

/** Profiles and platforms a hidden social menu links to; never link spam. */
const SOCIAL_DOMAINS = new Set([
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "threads.net",
  "whatsapp.com",
  "wa.me",
  "t.me",
  "telegram.me",
  "reddit.com",
  "github.com",
  "medium.com",
  "bsky.app",
  "mastodon.social",
  "snapchat.com",
  "discord.gg",
  "discord.com",
  "vimeo.com",
  "spotify.com",
  "apple.com",
  "google.com",
]);
const SPAM_LEXICON =
  /\b(?:casino|online\s+slots?|slot\s+gacor|gacor|togel|judi|poker|betting|sportsbook|viagra|cialis|levitra|pharmacy|payday\s+loans?|escort|porn|xxx|replica|essay\s+writing|crypto\s+airdrop)\b/i;
/**
 * Diversity is measured over this many leading words only: the type/token
 * ratio falls with length, so a long legitimate product tab would otherwise
 * read as repetitive.
 */
const DIVERSITY_WINDOW_WORDS = 200;

/** Same second-level label (acme.de for acme.com): a sister site, not a stranger. */
const firstLabel = (domain: string) => domain.split(".")[0];

/**
 * A warning for a hidden block that looks planted: a link farm (the hacked
 * site signature), keyword stuffing, bulk off-screen text, or spam vocabulary.
 * Hidden prose with sentences and a few links is left alone.
 */
function describeSuspiciousBlock(
  block: HiddenBlock,
  siteDomain: string | null,
): string[] {
  const text = block.text.replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ") : [];
  const head = words
    .slice(0, DIVERSITY_WINDOW_WORDS)
    .map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const diversity = head.length ? new Set(head).size / head.length : 1;
  const hasSentences = /[.!?¿¡。](?:\s|$)/.test(text);
  const external = block.links.filter(
    (link): link is { domain: string; text: string } =>
      link.domain !== null &&
      link.domain !== siteDomain &&
      !SOCIAL_DOMAINS.has(link.domain) &&
      (siteDomain === null ||
        firstLabel(link.domain) !== firstLabel(siteDomain)),
  );
  const externalDomains = new Set(external.map((link) => link.domain)).size;
  const anchors = external.map((link) => oneLine(link.text, 40));

  const linkFarm = external.length >= 5 && externalDomains >= 3;
  const stuffed = words.length >= 150 && (diversity < 0.3 || !hasSentences);
  const offScreenBulk = block.technique === "off-screen" && words.length >= 30;
  const spamWords =
    SPAM_LEXICON.test(`${text.slice(0, 500)} ${anchors.join(" ")}`) &&
    (external.length >= 2 || words.length >= 20);
  if (!linkFarm && !stuffed && !offScreenBulk && !spamWords) return [];

  const what =
    external.length > 0
      ? `${external.length} links to ${externalDomains} other sites (${anchors.slice(0, 3).join(", ")})`
      : `${words.length} words: "${text.slice(0, 120)}"`;
  return [`Hidden by inline ${block.technique} on <${block.tag}>, ${what}`];
}

// ---------------------------------------------------------------------------
// SPAM-17: scam and fraud (facts for the judge only)
// ---------------------------------------------------------------------------

const SUPPORT_SCAM =
  /\b(microsoft|windows|apple|mac|norton|mcafee|paypal|amazon|geek\s*squad|quickbooks|coinbase|metamask)\b[\s\S]{0,80}?\b(?:support|help\s*desk|customer\s*(?:care|service)|tech(?:nical)?\s*support)\b[\s\S]{0,120}?(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gi;
/** Brands whose product name is not the company's domain. */
const BRAND_OWNER: Record<string, string> = {
  windows: "microsoft",
  mac: "apple",
  geeksquad: "bestbuy",
};
const ALARM =
  /\b(?:your\s+(?:computer|pc|device|account)\s+(?:is|has\s+been)\s+(?:infected|blocked|locked|compromised|suspended)|do\s+not\s+(?:restart|close|shut\s*down)\s+your|call\s+(?:now|immediately)\s+to\s+(?:unlock|restore|avoid))/i;

/**
 * Whether the page's own domain is the brand's: Microsoft's support page on
 * microsoft.com is the real thing, the same text on win-help.example is not.
 */
function isOwnBrand(brand: string, siteDomain: string | null): boolean {
  if (!siteDomain) return false;
  const site = siteDomain.replace(/[^a-z0-9]/g, "");
  const token = brand.toLowerCase().replace(/\s+/g, "");
  const owner = BRAND_OWNER[token];
  return site.includes(token) || (owner !== undefined && site.includes(owner));
}

/**
 * What a tech-support or phishing scam leaves in the HTML. Each has innocent
 * explanations (SSO login forms, independent repair shops, security blogs
 * quoting scam pop-ups), which is why these are facts and not findings.
 */
function findScamFacts(scan: Scan, bodyText: string): string[] {
  const facts: string[] = [];
  for (const action of scan.credentialFormActions) {
    const target = registrableDomain(action || scan.pageUrl, scan.pageUrl);
    if (target && target !== scan.siteDomain) {
      facts.push(`A password form posts to another site: ${action}`);
    }
  }
  const support = [...bodyText.matchAll(SUPPORT_SCAM)].find(
    (match) => !isOwnBrand(match[1], scan.siteDomain),
  );
  if (support) {
    facts.push(
      `A third-party brand next to a support phone number: "${oneLine(support[0], 200)}"`,
    );
  }
  const alarm = ALARM.exec(bodyText);
  if (alarm) {
    facts.push(
      `Alarm language: "${oneLine(bodyText.slice(Math.max(0, alarm.index - 60), alarm.index + alarm[0].length + 60), 200)}"`,
    );
  }
  return facts;
}
