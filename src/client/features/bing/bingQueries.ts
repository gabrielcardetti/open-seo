import { queryOptions } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  getBingAiCitations,
  getBingBacklinks,
  getBingConnection,
  getBingCrawlHealth,
  getBingKeyStatus,
  getBingSummary,
  getBingTable,
  listBingSites,
} from "@/serverFunctions/bing";
import { BING_RANGE_DAYS, type BingRange } from "@/types/schemas/bing";

export type BingDates = { startDate: string; endDate: string };
type BingDateInput = BingDates | Record<string, never>;

/** Everything about one project's Bing data starts with this key, so a sync,
 *  a site change or a disconnect refreshes it all at once. */
export const bingProjectKey = (projectId: string) => ["bing", projectId];

export const bingKeyStatusOptions = () =>
  queryOptions({
    queryKey: ["bingKeyStatus"],
    queryFn: () => getBingKeyStatus(),
  });

export const bingConnectionOptions = (projectId: string) =>
  queryOptions({
    queryKey: [...bingProjectKey(projectId), "connection"],
    queryFn: () => getBingConnection({ data: { projectId } }),
  });

export const bingSitesOptions = (projectId: string) =>
  queryOptions({
    queryKey: [...bingProjectKey(projectId), "sites"],
    queryFn: () => listBingSites({ data: { projectId } }),
    staleTime: 0,
  });

/** Without dates the server picks the last 28 days of stored traffic, whose
 *  end date anchors the page's other ranges. */
export const bingSummaryOptions = (projectId: string, dates: BingDateInput) =>
  queryOptions({
    queryKey: [...bingProjectKey(projectId), "summary", dates],
    queryFn: () => getBingSummary({ data: { projectId, ...dates } }),
  });

export type BingTableInput = BingDates & {
  dimension: "query" | "page";
  search?: string;
  minPosition?: number;
  maxPosition?: number;
  sort: "clicks" | "impressions" | "ctr" | "position";
  page: number;
  pageSize: number;
};

export const bingTableOptions = (projectId: string, input: BingTableInput) =>
  queryOptions({
    queryKey: [...bingProjectKey(projectId), "table", input],
    queryFn: () => getBingTable({ data: { projectId, ...input } }),
  });

export const bingCrawlHealthOptions = (projectId: string, dates: BingDates) =>
  queryOptions({
    queryKey: [...bingProjectKey(projectId), "crawl", dates],
    queryFn: () => getBingCrawlHealth({ data: { projectId, ...dates } }),
  });

export const bingBacklinksOptions = (
  projectId: string,
  input: { url?: string; page: number; pageSize: number },
) =>
  queryOptions({
    queryKey: [...bingProjectKey(projectId), "backlinks", input],
    queryFn: () => getBingBacklinks({ data: { projectId, ...input } }),
  });

export const bingAiCitationsOptions = (projectId: string, dates: BingDates) =>
  queryOptions({
    queryKey: [...bingProjectKey(projectId), "ai", dates],
    queryFn: () => getBingAiCitations({ data: { projectId, ...dates } }),
  });

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** A preset's dates, counted back from the newest stored day. */
export function bingRangeDates(range: BingRange, endDate: string): BingDates {
  return {
    startDate: addDays(endDate, -(BING_RANGE_DAYS[range] - 1)),
    endDate,
  };
}

/** "Sep 3, 2026" for a YYYY-MM-DD day, without a timezone shift. */
export function formatBingDay(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
}

/** "Sep 3" for chart ticks and tooltips. */
export function formatBingTick(value: unknown): string {
  if (typeof value !== "string") return "";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Bing's impression-weighted average position, "—" when it has none. */
export function formatBingPosition(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

const BING_ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR:
    "Bing rejected the request. Check that your API key is still valid.",
  FORBIDDEN:
    "Bing says this API key can't read that site. Check the site is verified in the same Bing Webmaster account.",
  NOT_FOUND:
    "Bing couldn't find that site in the account behind your API key. Save a working key and try again.",
  RATE_LIMITED:
    "Bing is limiting requests for this API key right now. Try again in a few minutes.",
  UPSTREAM_UNAVAILABLE:
    "Bing Webmaster Tools didn't answer. Try again in a moment.",
};

/** Bing-specific wording for the error codes Bing calls end in. */
export function bingErrorMessage(error: unknown, fallback: string): string {
  const code = getErrorCode(error);
  return (code && BING_ERROR_MESSAGES[code]) || fallback;
}
