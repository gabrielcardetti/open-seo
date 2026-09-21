/**
 * Cloudflare's agent-readiness scanner, as a second opinion.
 *
 * Reached through its public MCP server (`scan_site` on isitagentready.com):
 * free, no key, and it takes the same content/apiApp profiles we use. The
 * catch is that it answers in markdown, not structured data, so this parses a
 * text format rather than a contract. The parse is deliberately strict: if it
 * recognises no check lines it reports an error instead of an empty — and
 * therefore spotless — result. The raw text is kept so the parser can always
 * be checked against what Cloudflare actually said.
 *
 * The structured alternative is the URL Scanner API with
 * `options.agentReadiness`; it needs the URL Scanner permission on the API
 * token, and would replace `parseCloudflareScan` without touching callers.
 */
import {
  readRetryAfter,
  UpstreamError,
  withRetry,
  type RetryPolicy,
} from "@/server/lib/retry";
import type {
  AgentReadinessProfile,
  CheckCategory,
  CheckResult,
  CheckStatus,
} from "./check-types";

const SCANNER_MCP_URL = "https://isitagentready.com/mcp";
const SCAN_TIMEOUT_MS = 60_000;

interface CloudflareScan {
  level: number | null;
  checks: CheckResult[];
  raw: string;
}

const CATEGORY_BY_HEADING: Array<[RegExp, CheckCategory]> = [
  [/^discoverability/i, "discoverability"],
  [/^content/i, "content"],
  [/^bot access/i, "botAccess"],
  [/^(api|auth|mcp|capabilit)/i, "capabilities"],
  // Commerce checks are unscored by Cloudflare; they sit with capabilities.
  [/^commerce/i, "capabilities"],
];

function statusFor(word: string): CheckStatus {
  switch (word.toUpperCase()) {
    case "PASS":
      return "pass";
    case "FAIL":
      return "fail";
    case "SKIP":
    case "N/A":
      return "not_applicable";
    default:
      return "info";
  }
}

/**
 * Parse the scanner's markdown report.
 *
 * Shape, as returned on 2026-09-21:
 *   **Level 1/5 -- Basic Web Presence**
 *   ## Discoverability (2/4 passing)
 *   - PASS robotsTxt: robots.txt exists with valid format
 *   - FAIL linkHeaders -- Include Link response headers ...
 *     No Link headers found on target page
 *     **Skill:** https://isitagentready.com/.well-known/agent-skills/link-headers/SKILL.md
 */
export function parseCloudflareScan(raw: string): CloudflareScan {
  const levelMatch = raw.match(/\*\*Level\s+(\d)\s*\/\s*5/i);
  const checks: CheckResult[] = [];
  let category: CheckCategory = "discoverability";
  let current: CheckResult | null = null;

  for (const line of raw.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*(\(|$)/);
    if (heading) {
      const found = CATEGORY_BY_HEADING.find(([pattern]) =>
        pattern.test(heading[1] ?? ""),
      );
      if (found) category = found[1];
      current = null;
      continue;
    }

    const check = line.match(
      /^-\s+(PASS|FAIL|SKIP|N\/A|INFO|WARN)\s+([A-Za-z0-9]+)\s*(?::|--)\s*(.*)$/,
    );
    if (check) {
      current = {
        checkId: check[2] ?? "",
        category,
        status: statusFor(check[1] ?? ""),
        message: (check[3] ?? "").trim().slice(0, 500),
        evidence: null,
        fixUrl: null,
      };
      checks.push(current);
      continue;
    }

    if (!current || !line.startsWith("  ")) continue;
    const skill = line.match(/\*\*Skill:\*\*\s*(\S+)/);
    if (skill) {
      current.fixUrl = skill[1] ?? null;
    } else if (!current.evidence && !/\*\*(Fix|Spec):\*\*/.test(line)) {
      // The first plain detail line is what the scanner actually observed.
      current.evidence = line.trim().slice(0, 300);
    }
  }

  return {
    level: levelMatch ? Number(levelMatch[1]) : null,
    checks,
    raw,
  };
}

/** The JSON-RPC envelope arrives either as JSON or as one SSE `data:` line. */
function readRpcBody(text: string): unknown {
  const sse = text.match(/^data:\s*(\{.*\})\s*$/m);
  return JSON.parse(sse ? (sse[1] ?? "") : text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textContent(envelope: unknown): string {
  if (!isRecord(envelope)) throw new Error("Scanner returned no envelope");
  if (isRecord(envelope.error)) {
    throw new Error(`Scanner error: ${String(envelope.error.message)}`);
  }
  const result = envelope.result;
  if (!isRecord(result)) throw new Error("Scanner returned no result");
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) =>
      isRecord(part) && part.type === "text" ? String(part.text) : "",
    )
    .join("");
  if (result.isError === true)
    throw new Error(`Scanner refused: ${text.slice(0, 200)}`);
  return text;
}

export async function scanWithCloudflare(input: {
  url: string;
  profile: AgentReadinessProfile;
  fetchImpl?: typeof fetch;
  retry?: RetryPolicy;
}): Promise<CloudflareScan> {
  const doFetch = input.fetchImpl ?? fetch;
  const raw = await withRetry(async () => {
    const response = await doFetch(SCANNER_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "scan_site",
          arguments: { url: input.url, profile: input.profile },
        },
      }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new UpstreamError(
        `Cloudflare scanner returned ${response.status}`,
        response.status,
        readRetryAfter(response),
      );
    }
    return textContent(readRpcBody(await response.text()));
  }, input.retry);

  const scan = parseCloudflareScan(raw);
  if (scan.checks.length === 0) {
    // An unrecognised report must not read as a site that passes everything.
    throw new Error("Could not read any checks from the Cloudflare report");
  }
  return scan;
}
