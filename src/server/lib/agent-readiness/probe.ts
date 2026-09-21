/**
 * The one way agent-readiness checks talk to a site.
 *
 * Every check goes through a `Probe`, so tests can hand the checks a scripted
 * site (including the soft-404 site that motivated half of them) without the
 * network. The real probe keeps the audit crawler's SSRF discipline: the
 * origin is validated once with a DNS check, and every redirect hop is
 * re-checked before it is followed.
 */
import { isCrawlableUrl } from "../audit/url-policy";

export interface ProbeResponse {
  /** Status of the final response, after redirects. */
  status: number;
  /** The URL that finally answered. */
  url: string;
  contentType: string;
  headers: Headers;
  body: string;
}

export interface ProbeRequest {
  headers?: Record<string, string>;
}

/** Null means the request itself failed: timeout, DNS, refused. */
export type Probe = (
  url: string,
  request?: ProbeRequest,
) => Promise<ProbeResponse | null>;

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
/** Enough for any robots.txt, well-known JSON or homepage worth judging. */
const MAX_BODY_BYTES = 512 * 1024;

const CHECKER_USER_AGENT =
  "Mozilla/5.0 (compatible; OpenSEO-AgentReadiness/1.0; +https://openseo.so)";

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (bytes < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, MAX_BODY_BYTES - bytes);
      bytes += chunk.byteLength;
      parts.push(decoder.decode(chunk, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parts.join("");
}

/**
 * A probe for one validated origin. Callers pass the origin through
 * `normalizeAndValidateStartUrl` first; this re-checks each hop so a redirect
 * cannot walk the checker into a private address.
 */
export function createProbe(fetchImpl: typeof fetch = fetch): Probe {
  return async (url, request = {}) => {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isCrawlableUrl(current)) return null;
      let response: Response;
      try {
        response = await fetchImpl(current, {
          redirect: "manual",
          headers: { "User-Agent": CHECKER_USER_AGENT, ...request.headers },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return null;
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        try {
          current = new URL(location, current).toString();
        } catch {
          return null;
        }
        continue;
      }
      return {
        status: response.status,
        url: current,
        contentType: response.headers.get("content-type") ?? "",
        headers: response.headers,
        body: await readBounded(response),
      };
    }
    return null;
  };
}
