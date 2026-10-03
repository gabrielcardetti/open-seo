import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonStatGrid } from "@/client/components/SkeletonPresets";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { AcquisitionTab } from "@/client/features/analytics/AcquisitionTab";
import {
  activeVisitorsOptions,
  analyticsDates,
  formatDay,
  type AnalyticsChannel,
} from "@/client/features/analytics/analyticsQueries";
import { ViewSwitch } from "@/client/features/analytics/AnalyticsParts";
import {
  AUDIENCE_VIEWS,
  BreakdownTab,
  PAGE_VIEWS,
} from "@/client/features/analytics/BreakdownTab";
import { EventsTab } from "@/client/features/analytics/EventsTab";
import { OverviewTab } from "@/client/features/analytics/OverviewTab";
import { SeoTab } from "@/client/features/analytics/SeoTab";
import { WebVitalsTab } from "@/client/features/analytics/WebVitalsTab";
import { UmamiConnectionCard } from "@/client/features/umami/UmamiConnectionCard";
import { umamiConnectionOptions } from "@/client/features/umami/umamiQueries";
import {
  UMAMI_ANALYTICS_TABS,
  UMAMI_RANGES,
  type UmamiAnalyticsSearch,
  type UmamiRangePreset,
} from "@/types/schemas/umami";

const RANGE_LABELS: Record<UmamiRangePreset, string> = {
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_90_days: "Last 90 days",
  last_6_months: "Last 6 months",
  last_12_months: "Last 12 months",
  custom: "Custom range",
};
const RANGE_ITEMS = UMAMI_RANGES.map((value) => ({
  value,
  label: RANGE_LABELS[value],
}));

const CHANNEL_ITEMS = [
  { value: "all", label: "All traffic" },
  { value: "organic_search", label: "Organic search" },
] as const;

export type AnalyticsTabProps = {
  projectId: string;
  dates: { startDate: string; endDate: string };
  channel: AnalyticsChannel;
  search: UmamiAnalyticsSearch;
  onSearchChange: (update: Partial<UmamiAnalyticsSearch>) => void;
};

/**
 * The project's Umami analytics: overview, organic search (joined with
 * Search Console and Bing), pages, acquisition, events and conversions,
 * audience and Web Vitals, read live from the connected Umami website.
 */
export function AnalyticsPage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: UmamiAnalyticsSearch;
  onSearchChange: (update: Partial<UmamiAnalyticsSearch>) => void;
}) {
  const connectionQuery = useQuery(umamiConnectionOptions(projectId));
  const connection = connectionQuery.data;

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              {connection?.connected && connection.website ? (
                <>
                  <span className="break-all">
                    {connection.website.name || connection.website.domain}
                  </span>
                  {" · "}
                  {connection.mode === "cloud"
                    ? "Umami Cloud"
                    : "Self-hosted Umami"}
                </>
              ) : (
                "Visitors, sources, events and Web Vitals from Umami, next to your Search Console and Bing data."
              )}
            </p>
          </div>
          {connection?.connected ? (
            <div className="flex shrink-0 items-center gap-3">
              <ActiveNow projectId={projectId} />
              <Link
                to="/p/$projectId/settings/integrations"
                params={{ projectId }}
                hash="umami"
                className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Manage connection
              </Link>
            </div>
          ) : null}
        </div>

        {connectionQuery.isPending ? (
          <SkeletonStatGrid />
        ) : !connection ? (
          <QueryError
            error={connectionQuery.error}
            fallback="Couldn't check this project's Umami connection."
            onRetry={() => void connectionQuery.refetch()}
            isRetrying={connectionQuery.isFetching}
          />
        ) : !connection.connected ? (
          <div className="max-w-2xl">
            <UmamiConnectionCard projectId={projectId} />
          </div>
        ) : (
          <AnalyticsBody
            projectId={projectId}
            search={search}
            onSearchChange={onSearchChange}
          />
        )}
      </div>
    </div>
  );
}

function ActiveNow({ projectId }: { projectId: string }) {
  const activeQuery = useQuery(activeVisitorsOptions(projectId));
  const active = activeQuery.data;
  if (!active?.connected) return null;
  return (
    <Badge
      variant="success"
      title="Visitors seen in the last 5 minutes, on every host the Umami website tracks"
    >
      <span className="size-1.5 rounded-full bg-current" />
      {active.activeVisitors} active now
    </Badge>
  );
}

function AnalyticsBody({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: UmamiAnalyticsSearch;
  onSearchChange: (update: Partial<UmamiAnalyticsSearch>) => void;
}) {
  const range = search.range ?? "last_28_days";
  const channel = search.channel ?? "all";
  const tab = search.tab ?? "overview";
  const dates = analyticsDates(range, { from: search.from, to: search.to });
  const props: AnalyticsTabProps = {
    projectId,
    dates,
    channel,
    search,
    onSearchChange,
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {formatDay(dates.startDate)} – {formatDay(dates.endDate)} (UTC)
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitch
            label="Traffic"
            value={channel}
            items={CHANNEL_ITEMS}
            onChange={(next) =>
              onSearchChange({ channel: next, page: undefined })
            }
          />
          <Select
            items={RANGE_ITEMS}
            value={range}
            onValueChange={(value) => {
              const next = UMAMI_RANGES.find((item) => item === value);
              if (!next) return;
              onSearchChange(
                next === "custom"
                  ? { range: next, from: dates.startDate, to: dates.endDate }
                  : { range: next, from: undefined, to: undefined },
              );
            }}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {range === "custom" ? (
        <CustomRange
          key={`${dates.startDate}-${dates.endDate}`}
          dates={dates}
          onApply={(from, to) => onSearchChange({ from, to, page: undefined })}
        />
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <DataTableTabs
          value={tab}
          onValueChange={(value) => {
            const next = UMAMI_ANALYTICS_TABS.find((item) => item === value);
            if (next) {
              onSearchChange({
                tab: next,
                view: undefined,
                q: undefined,
                page: undefined,
              });
            }
          }}
          description={
            tab === "seo"
              ? "Visits referred by search engines and AI assistants, whatever the traffic switch says."
              : undefined
          }
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="acquisition">Acquisition</TabsTrigger>
          <TabsTrigger value="events">Events & conversions</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
          <TabsTrigger value="vitals">Web Vitals</TabsTrigger>
        </DataTableTabs>
        <div className="p-4">
          {tab === "overview" ? (
            <OverviewTab {...props} />
          ) : tab === "seo" ? (
            <SeoTab {...props} />
          ) : tab === "pages" ? (
            <BreakdownTab key="pages" {...props} views={PAGE_VIEWS} />
          ) : tab === "acquisition" ? (
            <AcquisitionTab {...props} />
          ) : tab === "events" ? (
            <EventsTab {...props} />
          ) : tab === "audience" ? (
            <BreakdownTab key="audience" {...props} views={AUDIENCE_VIEWS} />
          ) : (
            <WebVitalsTab {...props} />
          )}
        </div>
      </div>
    </>
  );
}

function CustomRange({
  dates,
  onApply,
}: {
  dates: { startDate: string; endDate: string };
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(dates.startDate);
  const [to, setTo] = useState(dates.endDate);
  const valid = Boolean(from && to && from <= to);
  return (
    <form
      className="flex flex-wrap items-end justify-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onApply(from, to);
      }}
    >
      <label className="space-y-1 text-xs text-muted-foreground">
        From
        <Input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="h-8 w-40"
        />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        To
        <Input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="h-8 w-40"
        />
      </label>
      <Button type="submit" size="sm" disabled={!valid}>
        Apply
      </Button>
    </form>
  );
}
