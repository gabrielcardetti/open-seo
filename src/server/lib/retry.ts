/**
 * Retrying calls to rate-limited upstream services.
 *
 * Shared by every feature that calls a third party that answers 429 under load
 * (the guideline decision models, the agent-readiness scanner). The rule is the
 * same everywhere: back off and retry on rate limits and overloads, honour a
 * Retry-After, never retry a request that cannot succeed (400, 402).
 */

/** An upstream refusal carrying the status that decides whether to retry. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * Rate limits and overloads pass; bad requests and missing balance do not.
 * Retrying a 402 would only spend the caller's time budget failing the same way.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof UpstreamError) {
    return (
      error.status === 429 ||
      error.status === 529 ||
      (error.status !== null && error.status >= 500)
    );
  }
  // SDK bindings throw plain errors; read the transient ones by their message,
  // and leave everything else (402 balance, 400) terminal.
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|529|rate limit|overloaded|timed? ?out|temporarily)\b/i.test(
    message,
  );
}

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  /** No single wait may exceed this, whatever Retry-After asks for. */
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Four attempts with waits capped at 20s: at most a minute of backoff, which
 * fits inside a three-minute Workflow step or cron tick.
 */
const DEFAULT_RETRY: RetryPolicy = {
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
};

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  call: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<T> {
  const sleep = policy.sleep ?? realSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      if (attempt === policy.attempts || !isRetryable(error)) throw error;
      const asked = error instanceof UpstreamError ? error.retryAfterMs : null;
      const backoff = policy.baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.min(asked ?? backoff, policy.maxDelayMs));
    }
  }
  throw lastError;
}

/** Retry-After as milliseconds, from either delta-seconds or an HTTP date. */
export function readRetryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
