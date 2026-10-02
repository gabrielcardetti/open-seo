/**
 * One IndexNow request: POST the URLs of one host to api.indexnow.org, which
 * shares them with every participating engine (Bing, Yandex, Naver, Seznam…).
 * Google does not participate.
 *
 * https://www.indexnow.org/documentation
 */
import type { UrlSubmissionStatus } from "@/shared/indexing";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
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
 * attempts in total; the last outcome is what the ledger records.
 */
export async function postIndexNow(input: {
  host: string;
  key: string;
  keyLocation: string | null;
  urlList: string[];
}): Promise<IndexNowOutcome> {
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
  let attempts = 0;
  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    attempts += 1;
    try {
      const response = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel();
      outcome = outcomeFor(response.status);
    } catch {
      outcome = {
        status: "failed",
        httpStatus: null,
        errorMessage: "Could not reach IndexNow. Try again later.",
      };
    }
    if (!isRetryable(outcome)) break;
  }
  return { ...outcome, attempts };
}
