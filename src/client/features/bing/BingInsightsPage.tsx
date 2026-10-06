import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonStatGrid } from "@/client/components/SkeletonPresets";
import { StatTile } from "@/client/components/StatTile";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Card } from "@/client/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Skeleton } from "@/client/components/ui/skeleton";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { BingAiCitationsTab } from "@/client/features/bing/BingAiCitationsTab";
import { BingBacklinksTab } from "@/client/features/bing/BingBacklinksTab";
import { SearchTrafficChart } from "@/client/features/bing/BingCharts";
import { BingConnectionCard } from "@/client/features/bing/BingConnectionCard";
import {
  BingConnectionLost,
  BingSyncProblemAlert,
} from "@/client/features/bing/BingConnectionNotices";
import { BingCrawlHealthTab } from "@/client/features/bing/BingCrawlHealthTab";
import { BingPerformanceTab } from "@/client/features/bing/BingPerformanceTab";
import {
  bingConnectionOptions,
  bingErrorMessage,
  bingRangeDates,
  bingSummaryOptions,
  formatBingDay,
} from "@/client/features/bing/bingQueries";
import { BingSyncNowButton } from "@/client/features/bing/BingSyncNowButton";
import {
  formatCount,
  formatCtr,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  BING_DEFAULT_PAGE_SIZE,
  BING_INSIGHTS_TABS,
  BING_RANGE_DAYS,
  type BingInsightsSearch,
  type BingRange,
} from "@/types/schemas/bing";

const RANGE_LABELS: Record<BingRange, string> = {
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_90_days: "Last 90 days",
  last_6_months: "Last 6 months",
  last_12_months: "Last 12 months",
};
const RANGE_ITEMS = Object.entries(RANGE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function isRange(value: string): value is BingRange {
  return value in BING_RANGE_DAYS;
}

export function BingInsightsPage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: BingInsightsSearch;
  onSearchChange: (update: Partial<BingInsightsSearch>) => void;
}) {
  const connectionQuery = useQuery(bingConnectionOptions(projectId));
  const connection = connectionQuery.data;

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Bing Insights</h1>
            <p className="text-sm text-muted-foreground">
              {connection?.connected ? (
                <>
                  <span className="break-all">{connection.siteUrl}</span>
                  {" · "}
                  {connection.lastSyncedAt
                    ? `Synced ${formatRelativeTime(connection.lastSyncedAt)}`
                    : "Not synced yet"}
                </>
              ) : (
                "Clicks, impressions, crawl health and AI citations from Bing Webmaster Tools."
              )}
            </p>
          </div>
          {connection?.connected ? (
            <div className="flex shrink-0 items-center gap-3">
              <Link
                to="/p/$projectId/settings/integrations"
                params={{ projectId }}
                hash="bing-webmaster"
                className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Manage connection
              </Link>
              {connection.canManage ? (
                <BingSyncNowButton
                  projectId={projectId}
                  // The alert below says why and how to fix it.
                  disabled={connection.connectorKeyMissing}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {connection?.connected ? (
          <BingSyncProblemAlert connection={connection} />
        ) : null}

        {connectionQuery.isPending ? (
          <SkeletonStatGrid />
        ) : !connection ? (
          <QueryError
            error={connectionQuery.error}
            fallback="Couldn't check this project's Bing connection."
            onRetry={() => void connectionQuery.refetch()}
            isRetrying={connectionQuery.isFetching}
          />
        ) : !connection.connected ? (
          <div className="max-w-2xl">
            <BingConnectionCard projectId={projectId} />
          </div>
        ) : (
          <BingInsightsBody
            projectId={projectId}
            canManage={connection.canManage}
            neverSynced={!connection.lastSyncedAt}
            search={search}
            onSearchChange={onSearchChange}
          />
        )}
      </div>
    </div>
  );
}

function BingInsightsBody({
  projectId,
  canManage,
  neverSynced,
  search,
  onSearchChange,
}: {
  projectId: string;
  canManage: boolean;
  neverSynced: boolean;
  search: BingInsightsSearch;
  onSearchChange: (update: Partial<BingInsightsSearch>) => void;
}) {
  const range = search.range ?? "last_28_days";
  // Crawl days and imported AI days end on their own newest day, which can
  // be newer than the newest traffic day, so those tabs take a length.
  const days = BING_RANGE_DAYS[range];
  const tab = search.tab ?? "queries";
  // Without dates the server reads the last 28 stored days. Its end date (the
  // newest stored day; Bing lags a few days) anchors every other range.
  const anchorQuery = useQuery(bingSummaryOptions(projectId, {}));
  const anchor = anchorQuery.data;
  const dates = anchor?.connected
    ? bingRangeDates(range, anchor.range.endDate)
    : null;
  const summaryQuery = useQuery({
    ...bingSummaryOptions(
      projectId,
      range === "last_28_days" || !dates ? {} : dates,
    ),
    enabled: dates !== null,
    placeholderData: keepPreviousData,
  });
  const summary = summaryQuery.data;

  const failedQuery = anchorQuery.isError
    ? anchorQuery
    : summaryQuery.isError && !summary
      ? summaryQuery
      : null;
  if (failedQuery) {
    return (
      <QueryError
        cause={failedQuery.error}
        fallback={bingErrorMessage(
          failedQuery.error,
          "Couldn't load Bing data.",
        )}
        onRetry={() => void failedQuery.refetch()}
        isRetrying={failedQuery.isFetching}
      />
    );
  }
  // The cached connection said connected, but the project was disconnected
  // since (by another member, say).
  if (anchor?.connected === false || summary?.connected === false) {
    return <BingConnectionLost projectId={projectId} />;
  }
  if (!dates || !summary?.connected) {
    return <SkeletonStatGrid />;
  }

  const firstDay = summary.daily[0]?.date;
  const deltaHint = `vs ${formatBingDay(summary.range.prevStartDate)} – ${formatBingDay(summary.range.prevEndDate)}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {formatBingDay(summary.range.startDate)} –{" "}
          {formatBingDay(summary.range.endDate)}
        </p>
        <Select
          items={RANGE_ITEMS}
          value={range}
          onValueChange={(value) => {
            if (value !== null && isRange(value)) {
              onSearchChange({ range: value, page: undefined });
            }
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

      {neverSynced ? (
        <Alert variant="info">
          <AlertDescription>
            OpenSEO hasn&rsquo;t synced this site yet. The first sync runs
            within a few minutes of connecting
            {canManage ? ", or start it now with Sync now" : ""}.
          </AlertDescription>
        </Alert>
      ) : firstDay && firstDay > summary.range.startDate ? (
        <Alert variant="info">
          <AlertDescription>
            Bing history in OpenSEO starts on {formatBingDay(firstDay)}. Bing
            only shares about six months, so earlier days fill in as OpenSEO
            keeps its daily snapshots. Comparisons with the previous period
            appear once there is data to compare.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard
          label="Clicks"
          value={formatCount(summary.totals.clicks)}
          delta={{
            current: summary.totals.clicks,
            previous: summary.prevTotals.clicks,
          }}
          hint={deltaHint}
        />
        <MetricCard
          label="Impressions"
          value={formatCount(summary.totals.impressions)}
          delta={{
            current: summary.totals.impressions,
            previous: summary.prevTotals.impressions,
          }}
          hint={deltaHint}
        />
        <MetricCard
          label="CTR"
          value={formatCtr(summary.totals.ctr)}
          delta={{
            current: summary.totals.ctr,
            previous: summary.prevTotals.ctr,
          }}
          hint={deltaHint}
        />
      </div>

      <Card className="p-4">
        {summaryQuery.isPlaceholderData ? (
          <Skeleton className="h-56" />
        ) : summary.daily.length > 0 ? (
          <SearchTrafficChart
            data={summary.daily}
            label="Bing clicks and impressions per day"
          />
        ) : (
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            No Bing traffic stored for these dates.
          </div>
        )}
      </Card>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <DataTableTabs
          value={tab}
          onValueChange={(value) => {
            const next = BING_INSIGHTS_TABS.find((item) => item === value);
            if (next) {
              onSearchChange({
                tab: next,
                page: undefined,
                q: undefined,
                sort: undefined,
              });
            }
          }}
        >
          <TabsTrigger value="queries">Queries</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="striking">Striking distance</TabsTrigger>
          <TabsTrigger value="crawl">Crawl health</TabsTrigger>
          <TabsTrigger value="backlinks">Backlinks</TabsTrigger>
          <TabsTrigger value="ai">AI citations</TabsTrigger>
        </DataTableTabs>
        {tab === "queries" || tab === "pages" || tab === "striking" ? (
          <BingPerformanceTab
            key={tab}
            projectId={projectId}
            tab={tab}
            dates={dates}
            search={search}
            onSearchChange={onSearchChange}
          />
        ) : tab === "crawl" ? (
          <BingCrawlHealthTab projectId={projectId} days={days} />
        ) : tab === "backlinks" ? (
          <BingBacklinksTab
            projectId={projectId}
            page={search.page ?? 1}
            pageSize={search.size ?? BING_DEFAULT_PAGE_SIZE}
            onPageChange={(page) => onSearchChange({ page })}
            onPageSizeChange={(size) =>
              onSearchChange({ size, page: undefined })
            }
          />
        ) : (
          <BingAiCitationsTab
            projectId={projectId}
            days={days}
            canImport={canManage}
          />
        )}
      </div>
    </>
  );
}

function MetricCard(props: {
  label: string;
  value: string;
  delta: { current: number; previous: number };
  hint: string;
}) {
  return (
    <Card className="gap-0 p-4">
      <StatTile {...props} />
    </Card>
  );
}
