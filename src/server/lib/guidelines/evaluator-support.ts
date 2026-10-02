/**
 * What the deterministic evaluators share (rule-evaluators.ts and
 * bing-evaluators.ts): their shapes and the robots-directive parsing, kept in
 * a leaf module so the two do not import each other.
 */
import type { RuleStatus } from "@/shared/guidelines/catalog";
import type { FetchedPage } from "./page-fetch";
import type { SiteFacts } from "./site-facts";

/** What Bing Webmaster Tools last reported about one URL (BING-36). */
export interface BwtPageSnapshot {
  /** When the project's Bing data was last synced; null if never. */
  lastSyncedAt: string | null;
  /** Crawl issues Bing still reports for this URL (resolved ones left out). */
  openCrawlIssues: Array<{
    httpCode: number | null;
    issueFlags: number;
    firstSeenAt: string;
  }>;
}

export interface EvaluationContext {
  page: FetchedPage;
  /** Whether any internal link was seen pointing at this URL during the crawl. */
  hasInboundInternalLinks?: boolean;
  /** Site-level facts gathered once per audit. */
  site?: { facts?: SiteFacts };
  /** Bing Webmaster Tools data for this URL, when the project is connected. */
  bwt?: BwtPageSnapshot;
}

export interface DeterministicResult {
  status: RuleStatus;
  evidence?: string;
  reason?: string;
}

/** Null leaves the rule unsettled, to be routed as if there were no evaluator. */
export type Evaluator = (ctx: EvaluationContext) => DeterministicResult | null;

/** Site rules read only the site facts; undefined when none were gathered. */
export type SiteEvaluator = (
  facts: SiteFacts | undefined,
) => DeterministicResult | null;

export const directiveList = (value: string | null): string[] =>
  value ? value.split(",") : [];

/** Directives written `name: value`, which are not crawler names. */
const VALUED_DIRECTIVES = new Set([
  "unavailable_after",
  "max-snippet",
  "max-image-preview",
  "max-video-preview",
]);

/**
 * The `X-Robots-Tag` directives that apply to one crawler.
 *
 * The header can scope a directive to one crawler ("otherbot: noindex"), and
 * several headers arrive joined by commas. A named user agent holds until the
 * next one; directives before any name apply to every crawler.
 */
export function headerDirectivesFor(
  header: string,
  crawler: "googlebot" | "bingbot",
): string[] {
  const applying: string[] = [];
  let agent: string | null = null;
  for (const part of header.split(",")) {
    const scoped = part.match(/^\s*([a-z][\w-]*)\s*:\s*(.*)$/i);
    let directive = part.trim();
    if (scoped && !VALUED_DIRECTIVES.has(scoped[1].toLowerCase())) {
      agent = scoped[1].toLowerCase();
      directive = scoped[2].trim();
    }
    if (agent === null || agent === crawler) applying.push(directive);
  }
  return applying;
}

/** A URL without its fragment or trailing slash, for canonical comparison. */
export function comparableUrl(url: string, base?: string): string | null {
  try {
    const parsed = new URL(url, base);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
