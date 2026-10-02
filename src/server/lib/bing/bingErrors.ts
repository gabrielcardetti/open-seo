/**
 * How a failed Bing Webmaster call should be handled:
 * - `auth`: the API key is invalid or revoked; the user must save a new one.
 * - `site_access`: the key works but its account can't read this site.
 * - `throttled`: Bing rate-limited the user or host; retry later.
 * - `invalid`: Bing rejected a parameter (bad URL, unknown method input).
 * - `other`: internal/unknown errors and unexpected responses.
 */
export type BingErrorKind =
  | "auth"
  | "site_access"
  | "throttled"
  | "invalid"
  | "other";

export class BingApiError extends Error {
  constructor(
    public readonly kind: BingErrorKind,
    message: string,
    public readonly status: number,
    // Bing's ApiErrorCode, when the body carried one.
    public readonly errorCode?: number,
  ) {
    super(message);
    this.name = "BingApiError";
  }
}

export class BingNotConnectedError extends Error {
  constructor(public readonly projectId: string) {
    super("Bing Webmaster Tools is not connected for this project");
    this.name = "BingNotConnectedError";
  }
}
