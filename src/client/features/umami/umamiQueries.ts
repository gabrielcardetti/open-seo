import { queryOptions } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import { getUmamiConnection, listUmamiWebsites } from "@/serverFunctions/umami";

/** Everything about one project's Umami connection starts with this key, so
 *  saving, choosing a website or disconnecting refreshes it all. */
export const umamiProjectKey = (projectId: string) => ["umami", projectId];

export const umamiConnectionOptions = (projectId: string) =>
  queryOptions({
    queryKey: [...umamiProjectKey(projectId), "connection"],
    queryFn: () => getUmamiConnection({ data: { projectId } }),
  });

export const umamiWebsitesOptions = (projectId: string) =>
  queryOptions({
    queryKey: [...umamiProjectKey(projectId), "websites"],
    queryFn: () => listUmamiWebsites({ data: { projectId } }),
    // Fresh each time the picker opens; never hammer the instance.
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: (failureCount: number, error: unknown) =>
      !["FORBIDDEN", "NOT_FOUND", "RATE_LIMITED"].includes(
        getErrorCode(error) ?? "",
      ) && failureCount < 2,
  });

const UMAMI_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Umami no longer accepts the saved credentials. Save them again to continue.",
  NOT_FOUND:
    "Umami couldn't find that website with the saved credentials. Choose another one.",
  RATE_LIMITED: "Umami is limiting requests right now. Try again in a minute.",
  UPSTREAM_UNAVAILABLE: "Umami didn't answer. Try again in a moment.",
};

/** Umami-specific wording for the error codes Umami calls end in. */
export function umamiErrorMessage(error: unknown, fallback: string): string {
  const code = getErrorCode(error);
  return (code && UMAMI_ERROR_MESSAGES[code]) || fallback;
}
