import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SkeletonStatGrid } from "@/client/components/SkeletonPresets";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { DailyChart } from "@/client/features/analytics/AnalyticsCharts";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import {
  BarList,
  LiveRead,
  MetricCard,
} from "@/client/features/analytics/AnalyticsParts";
import {
  breakdownOptions,
  formatDay,
  formatDuration,
  formatPercent,
  overviewOptions,
} from "@/client/features/analytics/analyticsQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import type { UmamiBreakdownType } from "@/types/schemas/umami";

const TOP_LISTS: Array<{ type: UmamiBreakdownType; title: string }> = [
  { type: "path", title: "Top pages" },
  { type: "referrer", title: "Top referrers" },
  { type: "country", title: "Top countries" },
];

const COUNTRY_NAMES = new Intl.DisplayNames(undefined, { type: "region" });

function countryName(code: string): string {
  try {
    return (code && COUNTRY_NAMES.of(code.toUpperCase())) || code;
  } catch {
    return code;
  }
}

export function OverviewTab({ projectId, dates, channel }: AnalyticsTabProps) {
  const scope = { ...dates, channel };
  const overviewQuery = useQuery({
    ...overviewOptions(projectId, scope),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <LiveRead
        projectId={projectId}
        query={overviewQuery}
        fallback="Couldn't load the Umami overview."
        skeleton={<SkeletonStatGrid />}
      >
        {(overview) => {
          const hint = `vs ${formatDay(overview.request.previousDateRange.startDate)} – ${formatDay(overview.request.previousDateRange.endDate)}`;
          const { current, previous } = overview;
          return (
            <>
              {overview.organicDetection?.referrerDomains.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No search engine referred a visit in this period.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                <MetricCard
                  label="Visitors"
                  value={formatCount(current.visitors)}
                  delta={{
                    current: current.visitors,
                    previous: previous.visitors,
                  }}
                  hint={hint}
                />
                <MetricCard
                  label="Visits"
                  value={formatCount(current.visits)}
                  delta={{ current: current.visits, previous: previous.visits }}
                  hint={hint}
                />
                <MetricCard
                  label="Pageviews"
                  value={formatCount(current.pageviews)}
                  delta={{
                    current: current.pageviews,
                    previous: previous.pageviews,
                  }}
                  hint={hint}
                />
                <MetricCard
                  label="Bounce rate"
                  value={formatPercent(current.bounceRate)}
                  hint={`${formatPercent(previous.bounceRate)} before`}
                />
                <MetricCard
                  label="Avg. visit"
                  value={formatDuration(current.avgVisitSeconds)}
                  delta={{
                    current: current.avgVisitSeconds,
                    previous: previous.avgVisitSeconds,
                  }}
                  hint={hint}
                />
                <MetricCard
                  label="Views per visit"
                  value={current.viewsPerVisit?.toFixed(2) ?? "—"}
                  delta={{
                    current: current.viewsPerVisit,
                    previous: previous.viewsPerVisit,
                  }}
                  hint={hint}
                />
              </div>
              <Card className="p-4">
                {overviewQuery.isPlaceholderData ? (
                  <Skeleton className="h-56" />
                ) : (
                  <DailyChart
                    data={overview.trend}
                    label="Visitors and pageviews per day"
                    series={[
                      { key: "visitors", label: "Visitors" },
                      { key: "pageviews", label: "Pageviews" },
                    ]}
                  />
                )}
              </Card>
            </>
          );
        }}
      </LiveRead>
      <div className="grid gap-3 lg:grid-cols-3">
        {TOP_LISTS.map((list) => (
          <TopList
            key={list.type}
            projectId={projectId}
            scope={scope}
            type={list.type}
            title={list.title}
          />
        ))}
      </div>
    </div>
  );
}

function TopList({
  projectId,
  scope,
  type,
  title,
}: {
  projectId: string;
  scope: AnalyticsTabProps["dates"] & { channel: AnalyticsTabProps["channel"] };
  type: UmamiBreakdownType;
  title: string;
}) {
  const query = useQuery(
    breakdownOptions(projectId, { ...scope, type, limit: 6, offset: 0 }),
  );
  return (
    <Card className="gap-3 p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <LiveRead projectId={projectId} query={query} fallback="Couldn't load.">
        {(result) => (
          <BarList
            rows={result.rows.map((row) => ({
              label:
                type === "country"
                  ? countryName(row.name)
                  : type === "referrer"
                    ? row.name || "Direct / none"
                    : row.name,
              value: row.visitors ?? row.count ?? 0,
            }))}
          />
        )}
      </LiveRead>
    </Card>
  );
}
