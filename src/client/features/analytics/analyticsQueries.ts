import { queryOptions } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import { umamiProjectKey } from "@/client/features/umami/umamiQueries";
import {
  getUmamiActiveVisitors,
  getUmamiAnalyticsOverview,
  getUmamiBreakdownTable,
  getUmamiCampaignDetail,
  getUmamiCampaigns,
  getUmamiEventDetail,
  getUmamiEventList,
  getUmamiOrganicLandings,
  getUmamiSavedReports,
  getUmamiAiReferrals,
  getUmamiSearchEngines,
  getUmamiWebVitals,
  runUmamiAttribution,
  runUmamiFunnel,
  runUmamiJourney,
} from "@/serverFunctions/umamiAnalytics";
import {
  UMAMI_RANGE_DAYS,
  type UmamiBreakdownType,
  type UmamiRangePreset,
} from "@/types/schemas/umami";

export type AnalyticsDates = { startDate: string; endDate: string };
export type AnalyticsChannel = "all" | "organic_search";
type Scope = AnalyticsDates & { channel: AnalyticsChannel };

// A failed Umami call a retry can't fix (rejected credentials, a deleted
// website, a bad request) or must not hammer (throttling).
const NO_RETRY_CODES = new Set([
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
]);

/** Every read calls the Umami instance live: keep answers for a few minutes,
 *  don't refetch on focus, and don't retry what a retry can't fix. */
const live = {
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  retry: (failureCount: number, error: unknown) => {
    const code = getErrorCode(error);
    return !(code && NO_RETRY_CODES.has(code)) && failureCount < 2;
  },
};

const key = (projectId: string, ...parts: unknown[]) => [
  ...umamiProjectKey(projectId),
  "analytics",
  ...parts,
];

export const overviewOptions = (projectId: string, scope: Scope) =>
  queryOptions({
    queryKey: key(projectId, "overview", scope),
    queryFn: () => getUmamiAnalyticsOverview({ data: { projectId, ...scope } }),
    ...live,
  });

export const activeVisitorsOptions = (projectId: string) =>
  queryOptions({
    queryKey: key(projectId, "active"),
    queryFn: () => getUmamiActiveVisitors({ data: { projectId } }),
    ...live,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

export const breakdownOptions = (
  projectId: string,
  input: Scope & {
    type: UmamiBreakdownType;
    search?: string;
    limit: number;
    offset: number;
  },
) =>
  queryOptions({
    queryKey: key(projectId, "breakdown", input),
    queryFn: () => getUmamiBreakdownTable({ data: { projectId, ...input } }),
    ...live,
  });

export const searchEnginesOptions = (
  projectId: string,
  dates: AnalyticsDates,
) =>
  queryOptions({
    queryKey: key(projectId, "searchEngines", dates),
    queryFn: () => getUmamiSearchEngines({ data: { projectId, ...dates } }),
    ...live,
  });

export const aiReferralsOptions = (projectId: string, dates: AnalyticsDates) =>
  queryOptions({
    queryKey: key(projectId, "aiReferrals", dates),
    queryFn: () => getUmamiAiReferrals({ data: { projectId, ...dates } }),
    ...live,
  });

export const organicLandingsOptions = (
  projectId: string,
  dates: AnalyticsDates,
) =>
  queryOptions({
    queryKey: key(projectId, "organicLandings", dates),
    queryFn: () => getUmamiOrganicLandings({ data: { projectId, ...dates } }),
    ...live,
  });

export const campaignsOptions = (projectId: string, dates: AnalyticsDates) =>
  queryOptions({
    queryKey: key(projectId, "campaigns", dates),
    queryFn: () => getUmamiCampaigns({ data: { projectId, ...dates } }),
    ...live,
  });

export const campaignDetailOptions = (
  projectId: string,
  input: AnalyticsDates & { field: CampaignField; value: string },
) =>
  queryOptions({
    queryKey: key(projectId, "campaign", input),
    queryFn: () => getUmamiCampaignDetail({ data: { projectId, ...input } }),
    ...live,
  });

export type CampaignField =
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_content"
  | "utm_term";

export const eventListOptions = (projectId: string, scope: Scope) =>
  queryOptions({
    queryKey: key(projectId, "events", scope),
    queryFn: () => getUmamiEventList({ data: { projectId, ...scope } }),
    ...live,
  });

export const eventDetailOptions = (
  projectId: string,
  input: Scope & { event: string },
) =>
  queryOptions({
    queryKey: key(projectId, "event", input),
    queryFn: () => getUmamiEventDetail({ data: { projectId, ...input } }),
    ...live,
  });

export const savedReportsOptions = (projectId: string) =>
  queryOptions({
    queryKey: key(projectId, "savedReports"),
    queryFn: () => getUmamiSavedReports({ data: { projectId } }),
    ...live,
  });

type FunnelInput = Scope & {
  windowMinutes: number;
} & (
    | { reportId: string }
    | { steps: Array<{ type: "path" | "event"; value: string }> }
  );

export const funnelOptions = (projectId: string, input: FunnelInput) =>
  queryOptions({
    queryKey: key(projectId, "funnel", input),
    queryFn: () => runUmamiFunnel({ data: { projectId, ...input } }),
    ...live,
  });

export const journeyOptions = (
  projectId: string,
  input: Scope & { steps: number; startStep?: string },
) =>
  queryOptions({
    queryKey: key(projectId, "journey", input),
    queryFn: () => runUmamiJourney({ data: { projectId, ...input } }),
    ...live,
  });

export const attributionOptions = (
  projectId: string,
  input: Scope & {
    model: "first_click" | "last_click";
    step: { type: "path" | "event"; value: string };
  },
) =>
  queryOptions({
    queryKey: key(projectId, "attribution", input),
    queryFn: () => runUmamiAttribution({ data: { projectId, ...input } }),
    ...live,
  });

export const webVitalsOptions = (projectId: string, scope: Scope) =>
  queryOptions({
    queryKey: key(projectId, "vitals", scope),
    queryFn: () => getUmamiWebVitals({ data: { projectId, ...scope } }),
    ...live,
  });

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** A preset's dates, ending yesterday (UTC): Umami answers any range live,
 *  and complete days compare fairly with the period before. A custom range
 *  uses its own dates when both are valid. */
export function analyticsDates(
  range: UmamiRangePreset,
  custom: { from?: string; to?: string },
  now = new Date(),
): AnalyticsDates {
  const yesterday = addDays(now.toISOString().slice(0, 10), -1);
  if (
    range === "custom" &&
    custom.from &&
    custom.to &&
    custom.from <= custom.to
  ) {
    return { startDate: custom.from, endDate: custom.to };
  }
  const days = UMAMI_RANGE_DAYS[range === "custom" ? "last_28_days" : range];
  return { startDate: addDays(yesterday, -(days - 1)), endDate: yesterday };
}

/** "Sep 3, 2026" for a YYYY-MM-DD day, without a timezone shift. */
export function formatDay(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : `${(value * 100).toFixed(1)}%`;
}

const UMAMI_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Umami no longer accepts the saved credentials. Save them again in Settings → Integrations.",
  NOT_FOUND:
    "Umami couldn't find this website or report. Check the connection in Settings → Integrations.",
  RATE_LIMITED: "Umami is limiting requests right now. Try again in a minute.",
  UPSTREAM_UNAVAILABLE: "Umami didn't answer. Try again in a moment.",
};

export function analyticsErrorMessage(error: unknown, fallback: string) {
  const code = getErrorCode(error);
  return (code && UMAMI_ERROR_MESSAGES[code]) || fallback;
}
