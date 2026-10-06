/**
 * One IndexNow request: POST the URLs of one host to api.indexnow.org, which
 * shares them with every participating engine (Bing, Yandex, Naver, Seznam…).
 * Google does not participate.
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
 * attempts in total; the last outcome is what the ledger records. When the
 * last attempt still failed in transport (IndexNow or its relay unreachable,
 * see isTransportStatus), or the breaker is already open, the result is the
 * outage instead: nothing was asked of IndexNow, so there is no outcome.
 */
export async function postIndexNow(input: {
  host: string;
  key: string;
  keyLocation: string | null;
  urlList: string[];
}): Promise<IndexNowOutcome | { unreachable: UpstreamOutage }> {
  const gate = createUpstreamGate("indexnow");
  const blocked = await gate.admit();
  if (blocked) return { unreachable: blocked };
  const body = JSON.stringify({
    host: input.host,
    key: input.key,
    ...(input.keyLocation ? { keyLocation: input.keyLocation } : {}),
    urlList: input.urlList,
  });
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
