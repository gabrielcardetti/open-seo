import { AppError } from "@/server/lib/errors";
import {
  UmamiApiError,
  UmamiNotConnectedError,
} from "@/server/lib/umami/umamiErrors";

/** The expected ways an Umami read fails, as surfaced to the app and agents. */
export type UmamiFailureReason =
  | "not_connected"
  | "auth"
  | "website_not_found"
  | "throttled"
  | "api_error";

/** Classify an expected Umami failure; null for anything else (a real fault). */
export function classifyUmamiFailure(
  error: unknown,
): UmamiFailureReason | null {
  if (error instanceof UmamiNotConnectedError) return "not_connected";
  if (!(error instanceof UmamiApiError)) return null;
  switch (error.kind) {
    case "auth":
      return "auth";
    case "not_found":
      return "website_not_found";
    case "throttled":
      return "throttled";
    default:
      return "api_error";
  }
}

/** An Umami API failure as the AppError a server function throws. */
export function umamiAppError(error: UmamiApiError): AppError {
  switch (error.kind) {
    case "auth":
      return new AppError("FORBIDDEN", error.message);
    case "not_found":
      return new AppError("NOT_FOUND", error.message);
    case "throttled":
      return new AppError("RATE_LIMITED", error.message);
    default:
      return new AppError("UPSTREAM_UNAVAILABLE", error.message);
  }
}
