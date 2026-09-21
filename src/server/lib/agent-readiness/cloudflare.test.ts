import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCloudflareScan, scanWithCloudflare } from "./cloudflare";

// The scanner's real answer for apruebatuope.com on 2026-09-21: the parser is
// tested against what Cloudflare said, not against a format we imagined.
const REAL_REPORT = readFileSync(
  join(__dirname, "__fixtures__", "cloudflare-scan-apruebatuope-2026-09-21.md"),
  "utf8",
);

const noSleep = { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 };

function rpcResponse(text: string, init: ResponseInit = {}): Response {
  const envelope = {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  };
  return new Response(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

describe("parseCloudflareScan", () => {
  it("reads the level and every check from a real report", () => {
    const scan = parseCloudflareScan(REAL_REPORT);
    expect(scan.level).toBe(1);
    const byId = new Map(scan.checks.map((c) => [c.checkId, c]));
    expect(byId.get("robotsTxt")?.status).toBe("pass");
    expect(byId.get("markdownNegotiation")).toMatchObject({
      status: "fail",
      category: "content",
    });
    expect(byId.get("mcpServerCard")?.category).toBe("capabilities");
    // 2 + 2 discoverability, 1 content, 2 bot access, 9 capabilities.
    expect(scan.checks).toHaveLength(16);
  });

  it("keeps the observed detail and the fix guide for a failing check", () => {
    const link = parseCloudflareScan(REAL_REPORT).checks.find(
      (c) => c.checkId === "linkHeaders",
    );
    expect(link?.evidence).toBe("No Link headers found on target page");
    expect(link?.fixUrl).toBe(
      "https://isitagentready.com/.well-known/agent-skills/link-headers/SKILL.md",
    );
  });
});

describe("scanWithCloudflare", () => {
  it("returns the parsed scan with the raw report", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rpcResponse(REAL_REPORT));
    const scan = await scanWithCloudflare({
      url: "https://apruebatuope.com/",
      profile: "content",
      fetchImpl,
      retry: noSleep,
    });
    expect(scan.level).toBe(1);
    expect(scan.raw).toBe(REAL_REPORT);
  });

  // A changed format must surface as an error, never as a clean result.
  it("errors when it recognises no checks", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        rpcResponse("# Agent Readiness\nSomething new entirely."),
      );
    await expect(
      scanWithCloudflare({
        url: "https://site.test/",
        profile: "content",
        fetchImpl,
        retry: noSleep,
      }),
    ).rejects.toThrow("Could not read any checks");
  });

  it("retries a rate limit before giving up", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(rpcResponse(REAL_REPORT));
    const scan = await scanWithCloudflare({
      url: "https://site.test/",
      profile: "content",
      fetchImpl,
      retry: noSleep,
    });
    expect(scan.checks.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
