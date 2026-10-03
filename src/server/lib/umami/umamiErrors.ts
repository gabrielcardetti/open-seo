/**
 * How a failed Umami call should be handled:
 * - `auth`: Umami rejected the API key or login, or the user can't read the
 *   website (Umami answers 401 for both). The connection must be saved again.
 * - `not_found`: the website (or the API path) doesn't exist on that instance.
 * - `throttled`: Umami rate-limited the request; retry later.
 * - `unreachable`: the instance didn't answer, timed out, or failed (5xx).
 * - `other`: anything else, including responses that aren't Umami's.
 *
 * Messages never include credentials, tokens, or query strings.
 */
type UmamiErrorKind =
  | "auth"
  | "not_found"
  | "throttled"
  | "unreachable"
  | "other";

export class UmamiApiError extends Error {
  constructor(
    public readonly kind: UmamiErrorKind,
    message: string,
    // HTTP status when Umami answered; null when it never did.
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "UmamiApiError";
  }
}

export class UmamiNotConnectedError extends Error {
  constructor(public readonly projectId: string) {
    super("Umami is not connected for this project");
    this.name = "UmamiNotConnectedError";
  }
}
