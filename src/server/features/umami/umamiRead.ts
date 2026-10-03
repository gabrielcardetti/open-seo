import {
  openUmamiForProject,
  recordUmamiFailure,
  type ConnectedUmami,
} from "@/server/features/umami/umamiAccess";
import { TIME_ZONE, type UmamiRange } from "@/server/features/umami/umamiScope";

// What every Umami read shares: opening the project's website, remembering a
// failure the user must fix, and the source and request it answers with.

export function sourceOf({ connection, projectHost }: ConnectedUmami) {
  return {
    analytics: "umami" as const,
    mode: connection.mode,
    websiteId: connection.websiteId,
    websiteName: connection.websiteName,
    websiteDomain: connection.websiteDomain,
    // Reads count only this hostname (and its www twin), not every host the
    // Umami website tracks. Realtime visitors can't be filtered by host.
    projectHost,
  };
}

/** Open the project's Umami website, run a read, and remember a failure the
 *  user has to fix (bad credentials, a deleted website). */
export async function withUmami<T>(
  projectId: string,
  read: (umami: ConnectedUmami) => Promise<T>,
): Promise<T> {
  const umami = await openUmamiForProject(projectId);
  try {
    return await read(umami);
  } catch (error) {
    await recordUmamiFailure(projectId, error).catch(() => undefined);
    throw error;
  }
}

/** The fields every read answers with: where the data came from and the
 *  resolved request. */
export function sourceAndRequest<Extra extends Record<string, unknown>>(
  umami: ConnectedUmami,
  range: UmamiRange,
  extra: Extra,
) {
  return {
    ok: true as const,
    source: sourceOf(umami),
    request: {
      dateRange: { startDate: range.startDate, endDate: range.endDate },
      previousDateRange: {
        startDate: range.previousStartDate,
        endDate: range.previousEndDate,
      },
      timeZone: TIME_ZONE,
      ...extra,
    },
  };
}
