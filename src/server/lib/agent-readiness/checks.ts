/**
 * OpenSEO's own agent-readiness checks.
 *
 * Each check asks one question about a site and answers with evidence. The IDs
 * match Cloudflare's scanner wherever the two overlap, because the scan pairs
 * results by ID to compare the engines. A few checks exist here because no
 * public scanner runs them — the soft-404 check is the one that found the worst
 * problem on the first site we tested.
 *
 * Statuses are a contract:
 *   pass / fail     — the check ran and decided;
 *   not_applicable  — the site's profile does not call for it;
 *   info            — reported, never scored (llms.txt);
 *   error           — the check could not run. Never shown as a failure.
 */
import robotsParser from "robots-parser";
import { CAPABILITY_CHECKS } from "./capability-checks";
import {
  AGENT_READINESS_PROFILES,
  describe,
  isHtml,
  type AgentReadinessProfile,
  type CheckContext,
  type CheckDefinition,
  type CheckResult,
} from "./check-types";
import type { Probe } from "./probe";

const BOTH = AGENT_READINESS_PROFILES;

/** Real crawler user-agents, the strings sites match their rules against. */
const AI_BOTS: Array<{ token: string; userAgent: string }> = [
  {
    token: "GPTBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  },
  {
    token: "OAI-SearchBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  },
  {
    token: "ClaudeBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  },
  {
    token: "PerplexityBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  },
];

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const CHECKS: CheckDefinition[] = [
  {
    id: "robotsTxt",
    category: "discoverability",
    profiles: BOTH,
    fixUrl: "https://www.rfc-editor.org/rfc/rfc9309",
    async run(ctx) {
      const robots = await ctx.robots();
      if (!robots || robots.status !== 200) {
        return {
          status: "fail",
          message: "No robots.txt.",
          evidence: describe(robots),
        };
      }
      if (isHtml(robots)) {
        return {
          status: "fail",
          message: "robots.txt answers with an HTML page.",
          evidence: describe(robots),
        };
      }
      return /^\s*user-agent\s*:/im.test(robots.body)
        ? {
            status: "pass",
            message: "robots.txt is published with User-agent groups.",
            evidence: describe(robots),
          }
        : {
            status: "fail",
            message: "robots.txt has no User-agent group.",
            evidence: describe(robots),
          };
    },
  },
  {
    id: "sitemap",
    category: "discoverability",
    profiles: BOTH,
    fixUrl: "https://www.sitemaps.org/protocol.html",
    async run(ctx) {
      const robots = await ctx.robots();
      const declared =
        robots && robots.status === 200 && !isHtml(robots)
          ? robotsParser(`${ctx.origin}/robots.txt`, robots.body).getSitemaps()
          : [];
      const url = declared[0] ?? `${ctx.origin}/sitemap.xml`;
      const response = await ctx.probe(url);
      const ok =
        response?.status === 200 &&
        /<(urlset|sitemapindex)[\s>]/i.test(response.body);
      return ok
        ? {
            status: "pass",
            message: `Sitemap found${declared[0] ? " (declared in robots.txt)" : ""}.`,
            evidence: `${url}: ${describe(response)}`,
          }
        : {
            status: "fail",
            message: "No valid XML sitemap.",
            evidence: `${url}: ${describe(response)}`,
          };
    },
  },
  {
    id: "linkHeaders",
    category: "discoverability",
    profiles: BOTH,
    fixUrl:
      "https://isitagentready.com/.well-known/agent-skills/link-headers/SKILL.md",
    async run(ctx) {
      const home = await ctx.home();
      const link = home?.headers.get("link");
      return link && /rel\s*=/.test(link)
        ? {
            status: "pass",
            message: "The homepage advertises resources in Link headers.",
            evidence: link.slice(0, 300),
          }
        : {
            status: "fail",
            message: "No Link response headers on the homepage (RFC 8288).",
            evidence: describe(home),
          };
    },
  },
  {
    id: "markdownNegotiation",
    category: "content",
    profiles: BOTH,
    fixUrl:
      "https://isitagentready.com/.well-known/agent-skills/markdown-negotiation/SKILL.md",
    async run(ctx) {
      const response = await ctx.probe(`${ctx.origin}/`, {
        headers: { Accept: "text/markdown" },
      });
      return response?.contentType.includes("text/markdown")
        ? {
            status: "pass",
            message: "Accept: text/markdown returns markdown.",
            evidence: describe(response),
          }
        : {
            status: "fail",
            message: "Accept: text/markdown still returns HTML.",
            evidence: describe(response),
          };
    },
  },
  {
    id: "llmsTxt",
    category: "content",
    profiles: BOTH,
    fixUrl: "https://llmstxt.org/",
    // Informational only. Agents can use it; Google has said it gives it no
    // special treatment, so it is neither rewarded nor penalised here.
    async run(ctx) {
      const response = await ctx.probe(`${ctx.origin}/llms.txt`);
      const present = response?.status === 200 && !isHtml(response);
      return {
        status: "info",
        message: present ? "llms.txt is published." : "No llms.txt.",
        evidence: describe(response),
      };
    },
  },
  {
    id: "soft404",
    category: "content",
    profiles: BOTH,
    fixUrl:
      "https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors",
    async run(ctx) {
      const path = `/openseo-missing-${crypto.randomUUID().slice(0, 8)}`;
      const response = await ctx.probe(`${ctx.origin}${path}`);
      if (!response) {
        return {
          status: "error",
          message: "The missing-page probe got no response.",
        };
      }
      if (response.status === 404 || response.status === 410) {
        return {
          status: "pass",
          message: "A missing page answers 404.",
          evidence: `${path}: ${describe(response)}`,
        };
      }
      return {
        status: "fail",
        message:
          "A page that does not exist answers with a success status. Agents then read error pages as real documents (a missing /openapi.json looks present), and Google reports soft 404s.",
        evidence: `${path}: ${describe(response)}${response.url !== `${ctx.origin}${path}` ? ` (redirected to ${response.url})` : ""}`,
      };
    },
  },
  {
    id: "contentWithoutJs",
    category: "content",
    profiles: BOTH,
    fixUrl:
      "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
    async run(ctx) {
      const home = await ctx.home();
      if (!home || home.status !== 200) {
        return {
          status: "error",
          message: "The homepage did not load.",
          evidence: describe(home),
        };
      }
      // Loaded lazily: the parser stays out of the worker's baseline heap.
      const { analyzeHtml } = await import("../audit/page-analyzer");
      const words = analyzeHtml(home.body, home.url, home.status, 0).wordCount;
      return words >= 50
        ? {
            status: "pass",
            message: "The homepage's content is in the served HTML.",
            evidence: `${words} words without JavaScript`,
          }
        : {
            status: "fail",
            message:
              "The homepage has almost no text before JavaScript runs; agents that fetch HTML see an empty page.",
            evidence: `${words} words without JavaScript`,
          };
    },
  },
  {
    id: "robotsTxtAiRules",
    category: "botAccess",
    profiles: BOTH,
    fixUrl: "https://www.rfc-editor.org/rfc/rfc9309",
    async run(ctx) {
      const robots = await ctx.robots();
      if (!robots || robots.status !== 200 || isHtml(robots)) {
        return {
          status: "fail",
          message: "No robots.txt to declare AI bot rules in.",
          evidence: describe(robots),
        };
      }
      const parser = robotsParser(`${ctx.origin}/robots.txt`, robots.body);
      const explicit = AI_BOTS.filter((bot) =>
        new RegExp(`^\\s*user-agent\\s*:\\s*${bot.token}\\s*$`, "im").test(
          robots.body,
        ),
      );
      const access = AI_BOTS.map(
        (bot) =>
          `${bot.token}: ${parser.isAllowed(`${ctx.origin}/`, bot.token) === false ? "blocked" : "allowed"}`,
      ).join(", ");
      return explicit.length > 0
        ? {
            status: "pass",
            message: `robots.txt declares rules for ${explicit.map((b) => b.token).join(", ")}.`,
            evidence: access,
          }
        : {
            status: "fail",
            message:
              "robots.txt has no rules naming AI crawlers; they fall back to the * group.",
            evidence: access,
          };
    },
  },
  {
    id: "contentSignals",
    category: "botAccess",
    profiles: BOTH,
    fixUrl: "https://contentsignals.org/",
    async run(ctx) {
      const robots = await ctx.robots();
      const line = robots?.body.match(/^\s*content-signal\s*:.*$/im)?.[0];
      return line
        ? {
            status: "pass",
            message: "robots.txt declares Content Signals.",
            evidence: line.trim(),
          }
        : {
            status: "fail",
            message:
              "No Content-Signal directive stating how content may be used (search, ai-input, ai-train).",
          };
    },
  },
  {
    id: "aiBotAccess",
    category: "botAccess",
    profiles: BOTH,
    fixUrl: null,
    // Informational, not scored: a request that only claims a crawler's
    // user-agent cannot tell a site blocking that crawler from a firewall
    // rejecting an impostor (verified-bot checks key on IP, not UA).
    async run(ctx) {
      const browser = await ctx.probe(`${ctx.origin}/`, {
        headers: { "User-Agent": BROWSER_UA },
      });
      if (!browser || browser.status >= 400) {
        return {
          status: "error",
          message:
            "The homepage refused a browser too, so bot access cannot be compared.",
          evidence: describe(browser),
        };
      }
      const results = await Promise.all(
        AI_BOTS.map(async (bot) => ({
          bot: bot.token,
          response: await ctx.probe(`${ctx.origin}/`, {
            headers: { "User-Agent": bot.userAgent },
          }),
        })),
      );
      const refused = results.filter(
        ({ response }) =>
          !response ||
          response.status >= 400 ||
          response.headers.get("cf-mitigated"),
      );
      const evidence = results
        .map(
          ({ bot, response }) => `${bot}: ${response?.status ?? "no response"}`,
        )
        .join(", ");
      return refused.length === 0
        ? {
            status: "info",
            message:
              "The homepage answers AI crawler user-agents like a browser.",
            evidence,
          }
        : {
            status: "info",
            message: `Requests identifying as ${refused.map((r) => r.bot).join(", ")} were refused while a browser was served. Check the firewall or AI crawler settings: this can be a real block, or protection against impostors that the genuine crawler would pass.`,
            evidence,
          };
    },
  },
  ...CAPABILITY_CHECKS,
];

/** Memoize one probe so several checks can share the homepage or robots.txt. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}

/**
 * Run every check against one origin.
 *
 * A check that throws is recorded as `error`, never as a failure, and never
 * takes the other checks with it.
 */
export async function runAgentReadinessChecks(input: {
  origin: string;
  profile: AgentReadinessProfile;
  probe: Probe;
}): Promise<CheckResult[]> {
  const { origin, profile, probe } = input;
  const ctx: CheckContext = {
    origin,
    probe,
    home: once(() => probe(`${origin}/`)),
    robots: once(() => probe(`${origin}/robots.txt`)),
  };

  return Promise.all(
    CHECKS.map(async (check): Promise<CheckResult> => {
      const base = {
        checkId: check.id,
        category: check.category,
        fixUrl: check.fixUrl,
      };
      if (!check.profiles.includes(profile)) {
        return {
          ...base,
          status: "not_applicable",
          message: `Not expected of a ${profile === "content" ? "content site" : "product"}.`,
        };
      }
      try {
        return { ...base, ...(await check.run(ctx)) };
      } catch (error) {
        return {
          ...base,
          status: "error",
          message: `The check could not run: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
}

/** Scored checks only: `info`, `not_applicable` and `error` do not count. */
export function summarizeChecks(results: readonly CheckResult[]): {
  passed: number;
  applicable: number;
} {
  const scored = results.filter(
    (r) => r.status === "pass" || r.status === "fail",
  );
  return {
    passed: scored.filter((r) => r.status === "pass").length,
    applicable: scored.length,
  };
}
