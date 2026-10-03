import {
  inclusiveGa4Days,
  shiftGa4Date,
} from "@/server/features/ga4/services/Ga4Dates";
import type { ConnectedUmami } from "@/server/features/umami/umamiAccess";
import { searchEngineOf } from "@/server/features/umami/umamiSources";
import type { UmamiClient, UmamiFilters } from "@/server/lib/umami/umamiClient";

// The date range and the traffic an Umami read covers.

export type UmamiChannel = "organic_search" | "all";
export type RangeInput = { startDate?: string; endDate?: string };

const MAX_REFERRER_ROWS = 500;
const MAX_ORGANIC_DOMAINS = 100;

/**
 * Umami has no channel filter, only a channel breakdown, so organic search is
 * read as "arrived from a search engine": the referrer domains Umami recorded
 * in the period that belong to a search engine, sent as one `referrer`
 * equality filter. Paid clicks that carry a search referrer count too.
 * `filters` is null when no search engine referred anyone.
 */
async function organicFilters(
  client: UmamiClient,
  websiteId: string,
  startAt: number,
  endAt: number,
  hostFilter: UmamiFilters,
) {
  const referrers = await client.getMetrics({
    websiteId,
    startAt,
    endAt,
    type: "referrer",
    limit: MAX_REFERRER_ROWS,
    filters: hostFilter,
  });
  const domains = referrers
    .map((row) => row.name)
    .filter((name) => name && searchEngineOf(name) !== null)
    .slice(0, MAX_ORGANIC_DOMAINS);
  return {
    domains,
    filters:
      domains.length > 0
        ? ({
            ...hostFilter,
            referrer: `eq.${domains.join(",")}`,
          } satisfies UmamiFilters)
        : null,
  };
}

/** Umami buckets and reports these reads in UTC. */
export const TIME_ZONE = "UTC";

function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The requested range, or the last 28 complete UTC days, and the equal-length
 * period just before it. Umami reads are live, so an end date of today is
 * allowed (that day is partial).
 */
export function resolveUmamiRange(input: RangeInput, now = new Date()) {
  const endDate = input.endDate ?? shiftGa4Date(utcToday(now), -1);
  const startDate = input.startDate ?? shiftGa4Date(endDate, -27);
  const days = inclusiveGa4Days(startDate, endDate);
  const previousEndDate = shiftGa4Date(startDate, -1);
  const previousStartDate = shiftGa4Date(previousEndDate, -(days - 1));
  const endAt = Math.min(Date.parse(`${endDate}T23:59:59.999Z`), now.valueOf());
  return {
    startDate,
    endDate,
    previousStartDate,
    previousEndDate,
    startAt: Date.parse(`${startDate}T00:00:00.000Z`),
    endAt,
    previousStartAt: Date.parse(`${previousStartDate}T00:00:00.000Z`),
    previousEndAt: Date.parse(`${previousEndDate}T23:59:59.999Z`),
  };
}

export type UmamiRange = ReturnType<typeof resolveUmamiRange>;

/** Channel filters for a read, computed once over both compared periods. */
export async function channelFilters(
  { client, connection, hostFilter }: ConnectedUmami,
  channel: UmamiChannel,
  range: UmamiRange,
) {
  if (channel === "all") {
    return {
      filters: { ...hostFilter } as UmamiFilters,
      organicDetection: null,
    };
  }
  const organic = await organicFilters(
    client,
    connection.websiteId,
    range.previousStartAt,
    range.endAt,
    hostFilter,
  );
  return {
    filters: organic.filters,
    organicDetection: {
      method: "search_engine_referrers" as const,
      referrerDomains: organic.domains,
    },
  };
}
