/**
 * One IndexNow request: POST the URLs of one host to api.indexnow.org, which
 * shares them with every participating engine (Bing, Yandex, Naver, Seznam…).
 * When that path rate-limits, fails or can't be reached, the same request goes
 * straight to engines that take part: any of them shares an accepted
 * submission with the others. Google does not participate.
 *
 * https://www.indexnow.org/documentation
 */
import {
  createUpstreamGate,
  isTransportStatus,
  type UpstreamOutage,
} from "@/server/features/upstreams/upstreamBreaker";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { UrlSubmissionStatus } from "@/shared/indexing";

const INDEXNOW_ORIGIN = "https://api.indexnow.org";
/** IndexNow accepts at most 10,000 URLs per request. */
export const INDEXNOW_MAX_URLS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Waits before the 2nd and 3rd attempt of a throttled or failed request. */
const RETRY_DELAYS_MS = [250, 1_000];
/**
 * Engines tried in order, called directly, when api.indexnow.org (or the relay
 * in front of it) still refuses or fails after its retries. Bing is left out:
 * it is the one that rate-limits Cloudflare Workers' shared IPs.
 */
const FALLBACK_ENGINES = [
  "https://yandex.com/indexnow",
  "https://indexnow.yep.com/indexnow",
];

type IndexNowOutcome = {
  status: UrlSubmissionStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  attempts: number;
};

function outcomeFor(httpStatus: number): Omit<IndexNowOutcome, "attempts"> {
  const base = { httpStatus, errorMessage: null };
  switch (httpStatus) {
    case 200:
      return { ...base, status: "received" };
    case 202:
      return {
        ...base,
        status: "pending",
        errorMessage:
          "Accepted; IndexNow is still validating the key file. Later submissions go through once it reads it.",
      };
    case 400:
      return {
        ...base,
        status: "rejected",
        errorMessage: "IndexNow rejected the request as malformed.",
      };
    case 403:
      return {
        ...base,
        status: "rejected",
        errorMessage:
          "IndexNow could not validate the key: the key file is missing at its URL or does not contain exactly the key.",
      };
    case 422:
      return {
        ...base,
        status: "rejected",
        errorMessage:
          "IndexNow refused the URLs: they do not belong to the host, or the key does not match the key file.",
      };
    case 429:
      return {
        ...base,
        status: "throttled",
        errorMessage: "IndexNow is rate limiting this site. Try again later.",
      };
    default:
      return {
        ...base,
        status: "failed",
        errorMessage: `IndexNow answered HTTP ${httpStatus}.`,
      };
  }
}

const isRetryable = (outcome: Omit<IndexNowOutcome, "attempts">) =>
  outcome.status === "throttled" || outcome.status === "failed";

/**
 * Send one host's URLs. 429, 5xx and network failures are retried up to three
 * attempts in total, then the fallback engines are tried; the last outcome is
 * what the ledger records. When every route failed in transport (IndexNow or
 * its relay unreachable, see isTransportStatus, or the breaker already open)
 * and no engine answered, the result is the outage instead: nothing was
 * asked of IndexNow, so there is no outcome.
 */
export async function postIndexNow(input: {
  host: string;
  key: string;
  keyLocation: string | null;
  urlList: string[];
}): Promise<IndexNowOutcome | { unreachable: UpstreamOutage }> {
  const body = JSON.stringify({
    host: input.host,
    key: input.key,
    ...(input.keyLocation ? { keyLocation: input.keyLocation } : {}),
    urlList: input.urlList,
  });
  const primary = await postToIndexNow(body);
  if (!("unreachable" in primary) && !isRetryable(primary)) return primary;
  for (const endpoint of FALLBACK_ENGINES) {
    const outcome = await postToEngine(endpoint, body);
    if (outcome && !isRetryable(outcome)) {
      console.warn(
        `indexnow.fallback ${endpoint} answered HTTP ${outcome.httpStatus} for ${input.host}`,
      );
      return { ...outcome, attempts: 1 };
    }
  }
  return primary;
}

/** One POST straight to an engine; null when it didn't answer. */
async function postToEngine(
  endpoint: string,
  body: string,
): Promise<Omit<IndexNowOutcome, "attempts"> | null> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return outcomeFor(response.status);
  } catch {
    return null;
  }
}

/** api.indexnow.org, or the relay in front of it, behind the breaker. */
async function postToIndexNow(
  body: string,
): Promise<IndexNowOutcome | { unreachable: UpstreamOutage }> {
  const gate = createUpstreamGate("indexnow");
  const blocked = await gate.admit();
  if (blocked) return { unreachable: blocked };
  let outcome: Omit<IndexNowOutcome, "attempts"> = {
    status: "failed",
    httpStatus: null,
    errorMessage: "IndexNow was not reached.",
  };
  // IndexNow rate-limits Cloudflare Workers' shared outbound IPs (429), so a
  // deployment can send its requests through a relay that forwards /indexnow
  // and checks a shared secret — the same relay pattern as Bing's API.
  const origin =
    (await getOptionalEnvValue("INDEXNOW_API_BASE_URL"))?.replace(/\/+$/, "") ||
    INDEXNOW_ORIGIN;
  const relaySecret = await getOptionalEnvValue("INDEXNOW_RELAY_SECRET");
  let attempts = 0;
  let transportError: string | null = null;
  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    attempts += 1;
    try {
      const response = await fetch(`${origin}/indexnow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(relaySecret ? { "X-Relay-Secret": relaySecret } : {}),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel();
      transportError = isTransportStatus(response.status)
        ? `HTTP ${response.status}`
        : null;
      outcome = outcomeFor(response.status);
    } catch (error) {
      transportError =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "timed out"
          : "network error";
      outcome = {
        status: "failed",
        httpStatus: null,
        errorMessage: "Could not reach IndexNow. Try again later.",
      };
    }
    if (!isRetryable(outcome)) break;
  }
  if (transportError) return { unreachable: await gate.report(transportError) };
  await gate.reachable();
  return { ...outcome, attempts };
}
