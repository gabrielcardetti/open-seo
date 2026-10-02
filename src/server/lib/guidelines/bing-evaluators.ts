/**
 * Bing's page rules settled in TypeScript (the site rules are in
 * bing-site-evaluators.ts).
 *
 * Same contract as rule-evaluators.ts: a rule is answered here only when the
 * data decides it, and a heuristic whose threshold is ours (temporary
 * redirects, crawl waste, folded answers) only ever warns. Missing data is
 * `unknown` or null, never a pass.
 *
 * BING-30 is the one place a detector fails a page: text hidden from visitors
 * that orders a language model to drop its instructions or to recommend, cite
 * or say something has no innocent reading, and Bing names it as grounds for
 * removal. Weaker hits (the same text in an HTML comment) only warn.
 */
import {
  directiveList,
  headerDirectivesFor,
  comparableUrl,
  type BwtPageSnapshot,
  type Evaluator,
} from "./evaluator-support";
import type { FetchedPage } from "./page-fetch";

/** Where a robots directive for Bingbot was set, and its directives. */
interface DirectiveSource {
  where: string;
  raw: string;
  directives: string[];
}

/**
 * The robots directives Bing applies to a page: meta robots, meta bingbot,
 * and the X-Robots-Tag header (unscoped or scoped to bingbot).
 */
function bingDirectives(page: FetchedPage): DirectiveSource[] {
  const sources: DirectiveSource[] = [];
  const add = (where: string, raw: string | null, directives: string[]) => {
    if (!raw) return;
    sources.push({
      where,
      raw,
      directives: directives.map((d) => d.trim().toLowerCase()),
    });
  };
  add("meta robots", page.robotsMeta, directiveList(page.robotsMeta));
  add("meta bingbot", page.bingbotMeta, directiveList(page.bingbotMeta));
  add(
    "X-Robots-Tag",
    page.robotsHeader,
    headerDirectivesFor(page.robotsHeader ?? "", "bingbot"),
  );
  return sources;
}

function findDirective(
  page: FetchedPage,
  matches: (directive: string) => boolean,
): string | null {
  const source = bingDirectives(page).find((candidate) =>
    candidate.directives.some(matches),
  );
  return source ? `${source.where}: ${source.raw}` : null;
}

/**
 * What a "not found" page calls itself, at the start of its title or H1.
 * Anchored, so an article about 404 errors does not read as one, and only
 * trusted on a short page.
 */
const NOT_FOUND =
  /^(?:(?:error\s*)?404\b|(?:page|file|content)\s+not\s+found\b|not\s+found\b|(?:this|the)\s+page\s+(?:does\s+not|doesn't|no\s+longer)\s+exists?\b|(?:la\s+|esta\s+)?p[aá]gina\s+no\s+(?:encontrada|existe)\b|(?:contenido\s+)?no\s+encontrad[oa]\b|contenido\s+no\s+disponible\b)/i;
/** A real page is longer than this; a not-found template rarely is. */
const SOFT_404_MAX_WORDS = 300;

const TITLE_MIN_CHARS = 10;
const DESCRIPTION_MIN_CHARS = 70;

/** Bing's crawl-issue flags that mean the URL has a problem (redirects do not). */
const BWT_PROBLEM_FLAGS: ReadonlyArray<[number, string]> = [
  [4, "4xx"],
  [8, "5xx"],
  [16, "blocked by robots.txt"],
  [32, "contains malware"],
  [64, "important URL blocked by robots.txt"],
  [128, "DNS errors"],
  [256, "timeouts"],
];

const hostOf = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

function describeBwtIssue(
  issue: BwtPageSnapshot["openCrawlIssues"][number],
): string | null {
  const problems = BWT_PROBLEM_FLAGS.filter(
    ([flag]) => (issue.issueFlags & flag) !== 0,
  ).map(([, label]) => label);
  if (problems.length === 0) return null;
  return `${problems.join(", ")}${issue.httpCode ? ` (HTTP ${issue.httpCode})` : ""} since ${issue.firstSeenAt.slice(0, 10)}`;
}

export const bingPageEvaluators: Record<string, Evaluator> = {
  // NOARCHIVE takes the page out of Copilot; NOCACHE (which Bing applies
  // when both are set) only limits what Copilot shows of it.
  "BING-08": ({ page }) => {
    const nocache = findDirective(page, (d) => d === "nocache");
    if (nocache) {
      return {
        status: "warn",
        evidence: nocache,
        reason:
          "NOCACHE limits Copilot to the page's URL, title and snippet when it cites it.",
      };
    }
    const noarchive = findDirective(page, (d) => d === "noarchive");
    return noarchive
      ? {
          status: "fail",
          evidence: noarchive,
          reason:
            "NOARCHIVE keeps the page out of Copilot answers and grounding results; remove it unless that is intended.",
        }
      : { status: "pass" };
  },

  "BING-09": ({ page }) => {
    const nosnippet = findDirective(
      page,
      (d) => d === "nosnippet" || /^max-snippet\s*:\s*0$/.test(d),
    );
    if (nosnippet) {
      return {
        status: "fail",
        evidence: nosnippet,
        reason:
          "Bing shows no caption for the page and may cite it with less of its text.",
      };
    }
    return page.dataNosnippet > 0
      ? {
          status: "warn",
          evidence: `${page.dataNosnippet} element(s) marked data-nosnippet`,
          reason:
            "Text marked data-nosnippet is left out of Bing captions and may limit Copilot citations.",
        }
      : { status: "pass" };
  },

  // A canonical to another site is what a move left behind; to another URL
  // of the same site it may be duplicate consolidation, which is legitimate.
  "BING-06": ({ page }) => {
    if (!page.canonical) return { status: "pass" };
    const target = comparableUrl(page.canonical, page.finalUrl);
    if (target === null || target === comparableUrl(page.finalUrl)) {
      return { status: "pass" };
    }
    if (hostOf(target) !== hostOf(page.finalUrl)) {
      return {
        status: "warn",
        evidence: page.canonical,
        reason:
          "The page declares a canonical on another site. If the content moved there, Bing wants a 301 redirect instead; a syndicated copy may keep the canonical.",
      };
    }
    return {
      status: "unknown",
      evidence: page.canonical,
      reason:
        "The canonical points to another URL of the site; whether the content moved (redirect) or is a duplicate that stays (canonical) needs a look.",
    };
  },

  "BING-07": ({ page }) => {
    const label = [page.title.split(/\s[|–—-]\s/)[0] ?? "", ...page.h1s]
      .map((text) => text.trim())
      .find((text) => NOT_FOUND.test(text));
    if (!label) return { status: "pass" };
    if (page.wordCount >= SOFT_404_MAX_WORDS) {
      return {
        status: "unknown",
        evidence: label,
        reason:
          "The title or H1 reads as a not-found page, but the page has substantial text; check whether it is one.",
      };
    }
    return {
      status: "fail",
      evidence: `HTTP ${page.statusCode}, "${label}"`,
      reason:
        "A not-found page answers 200 (a soft 404); removed content should return 404 or 410.",
    };
  },

  "BING-13": ({ page, site }) => {
    const missing = [
      !page.title.trim() && "title",
      !page.metaDescription.trim() && "meta description",
    ].filter(Boolean);
    if (missing.length > 0) {
      return {
        status: "fail",
        reason: `The page has no ${missing.join(" and no ")}.`,
      };
    }
    const bing = site?.facts?.bing;
    const notes = [
      page.title.trim().length < TITLE_MIN_CHARS &&
        `title is ${page.title.trim().length} characters`,
      page.metaDescription.trim().length < DESCRIPTION_MIN_CHARS &&
        `meta description is ${page.metaDescription.trim().length} characters`,
      bing?.duplicateTitleUrls.includes(page.url) &&
        "another crawled page has the same title",
      bing?.duplicateDescriptionUrls.includes(page.url) &&
        "another crawled page has the same meta description",
    ].filter((note): note is string => typeof note === "string");
    if (notes.length > 0) {
      return {
        status: "warn",
        evidence: notes.join("; "),
        reason: "Bing reads short or repeated titles and descriptions as weak.",
      };
    }
    return bing
      ? { status: "pass" }
      : {
          status: "pass",
          evidence:
            "Present and not short; repeats on other pages not checked.",
        };
  },

  "BING-14": ({ page }) => {
    const order = page.headingOrder;
    if (order.length === 0) {
      return {
        status: "warn",
        reason: "The page has no headings to structure its content.",
      };
    }
    const skip = order.findIndex(
      (level, index) => index > 0 && level > order[index - 1] + 1,
    );
    return skip === -1
      ? { status: "pass" }
      : {
          status: "warn",
          evidence: `h${order[skip - 1]} followed by h${order[skip]}`,
          reason: "The heading hierarchy skips a level.",
        };
  },

  "BING-20": ({ page }) => {
    if (page.wordCount >= 150) return { status: "pass" };
    if (page.imagesTotal > 0 && page.wordCount < 50) {
      return {
        status: "warn",
        evidence: `${page.wordCount} words, ${page.imagesTotal} images`,
        reason:
          "Almost no text next to the images: the information may only be in them.",
      };
    }
    return {
      status: "unknown",
      reason:
        "Little text on the page; whether images or video carry the information needs a look.",
    };
  },

  "BING-30": ({ page }) => {
    const { promptInjection, promptInjectionLeads } = page.spamSignals;
    if (promptInjection.length > 0) {
      return {
        status: "fail",
        evidence: promptInjection.join(" | "),
        reason:
          "Text hidden from visitors gives orders to a language model, which Bing treats as manipulation of Bing and Copilot.",
      };
    }
    if (promptInjectionLeads.length > 0) {
      return {
        status: "warn",
        evidence: promptInjectionLeads.join(" | "),
        reason:
          "An HTML comment gives orders to a language model; models that read raw HTML may follow it.",
      };
    }
    return null;
  },

  // Only `<details>` left closed is visible in the HTML; tabs hidden by a
  // stylesheet are not, so finding nothing proves nothing.
  "BING-34": ({ page }) =>
    page.collapsedWords >= 150 && page.collapsedWords >= page.wordCount * 0.3
      ? {
          status: "warn",
          evidence: `${page.collapsedWords} of ${page.wordCount} words inside closed <details>`,
          reason:
            "Much of the page is folded away; AI systems that do not render it may skip those answers.",
        }
      : null,

  "BING-35": ({ page }) => {
    if (page.pdfLinks === 0 || page.wordCount >= 300) {
      return { status: "pass" };
    }
    return page.wordCount < 150
      ? {
          status: "warn",
          evidence: `${page.wordCount} words, ${page.pdfLinks} PDF link(s)`,
          reason: "The page is mostly a pointer to PDFs.",
        }
      : null;
  },

  "BING-36": ({ bwt }) => {
    if (!bwt) {
      return { status: "unknown", reason: "No Bing Webmaster Tools data." };
    }
    if (!bwt.lastSyncedAt) {
      return {
        status: "unknown",
        reason:
          "Bing Webmaster Tools has not been synced for this project yet.",
      };
    }
    const problems = bwt.openCrawlIssues.flatMap((issue) => {
      const described = describeBwtIssue(issue);
      return described ? [described] : [];
    });
    return problems.length > 0
      ? {
          status: "fail",
          evidence: problems.join(" | "),
          reason: "Bing Webmaster Tools reports a crawl problem for this URL.",
        }
      : {
          status: "pass",
          evidence: `No open crawl issue as of ${bwt.lastSyncedAt.slice(0, 10)}.`,
        };
  },
};
