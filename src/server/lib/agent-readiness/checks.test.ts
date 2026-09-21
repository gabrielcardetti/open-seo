import { describe, expect, it } from "vitest";
import type { CheckResult } from "./check-types";
import { runAgentReadinessChecks, summarizeChecks } from "./checks";
import type { Probe, ProbeResponse } from "./probe";

const ORIGIN = "https://site.test";

function response(
  status: number,
  body: string,
  contentType: string,
  headers: Record<string, string> = {},
  url = ORIGIN,
): ProbeResponse {
  return {
    status,
    url,
    contentType,
    headers: new Headers({ "content-type": contentType, ...headers }),
    body,
  };
}

const HTML_SHELL = `<!doctype html><html><body><div id="root"></div></body></html>`;
const RICH_HOME = `<!doctype html><html><body><main>${"Palabra ".repeat(80)}</main></body></html>`;

/**
 * A scripted site. Unknown paths answer with `fallback`, which is how a site
 * with the soft-404 bug behaves: every path is "found".
 */
function site(
  routes: Record<string, ProbeResponse>,
  fallback: ProbeResponse | null = response(404, "Not found", "text/plain"),
  byUserAgent: (ua: string) => ProbeResponse | null = () => null,
): Probe {
  return (url, request) => {
    const path = url.replace(ORIGIN, "") || "/";
    const ua = request?.headers?.["User-Agent"];
    const override = ua ? byUserAgent(ua) : null;
    if (override) return Promise.resolve(override);
    const accept = request?.headers?.Accept;
    if (accept === "text/markdown" && routes["md:" + path]) {
      return Promise.resolve(routes["md:" + path]);
    }
    return Promise.resolve(routes[path] ?? fallback);
  };
}

const byId = (results: CheckResult[]) =>
  new Map(results.map((result) => [result.checkId, result]));

describe("runAgentReadinessChecks", () => {
  // The bug no public scanner flagged on the first real site we tested: every
  // path answers 200 with the app's HTML shell.
  it("fails a site that answers missing pages with 200", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "content",
        probe: site(
          { "/": response(200, RICH_HOME, "text/html") },
          response(200, HTML_SHELL, "text/html"),
        ),
      }),
    );
    expect(results.get("soft404")?.status).toBe("fail");
  });

  it("passes a site that answers missing pages with 404", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "content",
        probe: site({ "/": response(200, RICH_HOME, "text/html") }),
      }),
    );
    expect(results.get("soft404")?.status).toBe("pass");
  });

  // Without this, a soft-404 site "publishes" every well-known document.
  it("does not accept an HTML page as a well-known JSON document", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "apiApp",
        probe: site(
          { "/": response(200, RICH_HOME, "text/html") },
          response(200, HTML_SHELL, "text/html"),
        ),
      }),
    );
    const card = results.get("mcpServerCard");
    expect(card?.status).toBe("fail");
    expect(card?.message).toMatch(/HTML/);
  });

  it("accepts a real well-known JSON document", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "apiApp",
        probe: site({
          "/": response(200, RICH_HOME, "text/html"),
          "/.well-known/oauth-protected-resource": response(
            200,
            JSON.stringify({ resource: "https://site.test" }),
            "application/json",
          ),
        }),
      }),
    );
    expect(results.get("oauthProtectedResource")?.status).toBe("pass");
  });

  // A content site is not penalised for standards meant for APIs.
  it("marks capability checks not applicable for a content site", async () => {
    const results = await runAgentReadinessChecks({
      origin: ORIGIN,
      profile: "content",
      probe: site({ "/": response(200, RICH_HOME, "text/html") }),
    });
    const capabilities = results.filter((r) => r.category === "capabilities");
    expect(capabilities.length).toBeGreaterThan(0);
    expect(capabilities.every((r) => r.status === "not_applicable")).toBe(true);
  });

  it("reads per-bot access and explicit AI rules from robots.txt", async () => {
    const robots = [
      "User-agent: *",
      "Allow: /",
      "User-agent: GPTBot",
      "Disallow: /",
      "Content-Signal: search=yes, ai-train=no",
      "Sitemap: https://site.test/sitemap-main.xml",
    ].join("\n");
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "content",
        probe: site({
          "/": response(200, RICH_HOME, "text/html"),
          "/robots.txt": response(200, robots, "text/plain"),
          "/sitemap-main.xml": response(
            200,
            "<urlset></urlset>",
            "application/xml",
          ),
        }),
      }),
    );
    expect(results.get("robotsTxtAiRules")).toMatchObject({ status: "pass" });
    expect(results.get("robotsTxtAiRules")?.evidence).toContain(
      "GPTBot: blocked",
    );
    expect(results.get("contentSignals")?.status).toBe("pass");
    // The sitemap declared in robots.txt is the one checked.
    expect(results.get("sitemap")?.status).toBe("pass");
  });

  it("reports llms.txt without scoring it", async () => {
    const results = await runAgentReadinessChecks({
      origin: ORIGIN,
      profile: "content",
      probe: site({
        "/": response(200, RICH_HOME, "text/html"),
        "/llms.txt": response(200, "# Site", "text/plain"),
      }),
    });
    expect(byId(results).get("llmsTxt")?.status).toBe("info");
    const summary = summarizeChecks(results);
    expect(summary.applicable).toBe(
      results.filter((r) => r.status === "pass" || r.status === "fail").length,
    );
  });

  it("detects markdown content negotiation", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "content",
        probe: site({
          "/": response(200, RICH_HOME, "text/html"),
          "md:/": response(200, "# Home", "text/markdown; charset=utf-8"),
        }),
      }),
    );
    expect(results.get("markdownNegotiation")?.status).toBe("pass");
  });

  it("flags a homepage that is empty before JavaScript runs", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "content",
        probe: site({ "/": response(200, HTML_SHELL, "text/html") }),
      }),
    );
    expect(results.get("contentWithoutJs")?.status).toBe("fail");
  });

  // A UA-only probe cannot tell a real block from impostor protection, so it
  // informs rather than fails.
  it("reports refused AI crawler user-agents as information", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "content",
        probe: site(
          { "/": response(200, RICH_HOME, "text/html") },
          undefined,
          (ua) =>
            ua.includes("GPTBot")
              ? response(403, "blocked", "text/html", {
                  "cf-mitigated": "challenge",
                })
              : null,
        ),
      }),
    );
    const access = results.get("aiBotAccess");
    expect(access?.status).toBe("info");
    expect(access?.message).toContain("GPTBot");
  });

  // "Could not evaluate" must never read as "failed".
  it("records a check that cannot reach the site as an error", async () => {
    const results = byId(
      await runAgentReadinessChecks({
        origin: ORIGIN,
        profile: "content",
        probe: () => Promise.resolve(null),
      }),
    );
    expect(results.get("soft404")?.status).toBe("error");
    expect(results.get("contentWithoutJs")?.status).toBe("error");
  });
});
