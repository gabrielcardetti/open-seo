import { AppError } from "@/server/lib/errors";
import {
  BingApiError,
  BingNotConnectedError,
} from "@/server/lib/bing/bingErrors";

/** The expected ways a Bing read fails, as surfaced to the app and agents. */
export type BingFailureReason =
  | "not_connected"
  | "key_invalid"
  | "site_access"
  | "throttled"
  | "api_error";

/** Classify an expected Bing failure; null for anything else (a real fault). */
export function classifyBingFailure(error: unknown): BingFailureReason | null {
  if (error instanceof BingNotConnectedError) return "not_connected";
  if (!(error instanceof BingApiError)) return null;
  switch (error.kind) {
    case "auth":
      return "key_invalid";
    case "site_access":
      return "site_access";
    case "throttled":
      return "throttled";
    default:
      return "api_error";
  }
}

/** A Bing API failure as the AppError a server function throws. */
export function bingAppError(error: BingApiError): AppError {
  switch (error.kind) {
    case "auth":
    case "invalid":
      return new AppError("VALIDATION_ERROR", error.message);
    case "site_access":
      return new AppError("FORBIDDEN", error.message);
    case "throttled":
      return new AppError("RATE_LIMITED", error.message);
    default:
      return new AppError("UPSTREAM_UNAVAILABLE", error.message);
  }
}
