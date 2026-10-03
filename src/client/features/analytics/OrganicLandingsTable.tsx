import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { QueryError } from "@/client/components/QueryState";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import {
  AnalyticsConnectionLost,
  SearchBox,
  ViewSwitch,
} from "@/client/features/analytics/AnalyticsParts";
import {
  analyticsErrorMessage,
  formatDuration,
  formatPercent,
  organicLandingsOptions,
} from "@/client/features/analytics/analyticsQueries";
import {
  formatCount,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import type { getUmamiOrganicLandings } from "@/serverFunctions/umamiAnalytics";
import { UMAMI_PAGE_SIZES } from "@/types/schemas/umami";

type LandingRow = Extract<
  Awaited<ReturnType<typeof getUmamiOrganicLandings>>,
  { connected: true }
>["rows"][number];

const FILTERS = [
  { value: "all", label: "All pages" },
  { value: "retention", label: "High impressions, poor retention" },
  { value: "unattributed", label: "Visits without Google clicks" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

const helper = createColumnHelper<LandingRow>();

function sortable(label: string) {
  return ({
    column,
  }: {
    column: Parameters<typeof SortableHeader>[0]["column"];
  }) => <SortableHeader column={column} label={label} align="right" />;
}

function buildColumns(projectId: string) {
  return [
    helper.accessor("path", {
      enableSorting: false,
      header: () => "Landing page",
      cell: ({ row }) => (
        <div className="max-w-md space-y-1">
          <span className="block truncate" title={row.original.path}>
            {row.original.path}
          </span>
          <div className="flex flex-wrap gap-1">
            {row.original.highImpressionsPoorRetention ? (
              <Badge size="sm" variant="warning">
                Poor retention
              </Badge>
            ) : null}
            {row.original.visitsWithoutGscClicks ? (
              <Badge size="sm" variant="info">
                No Google clicks
              </Badge>
            ) : null}
            <Link
              to="/p/$projectId/search-performance"
              params={{ projectId }}
              search={{
                tab: "pages",
                pageText: row.original.path,
                pageMatch: "contains",
              }}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              GSC
            </Link>
            <Link
              to="/p/$projectId/bing"
              params={{ projectId }}
              search={{ tab: "pages", q: row.original.path }}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Bing
            </Link>
          </div>
        </div>
      ),
    }),
    helper.accessor("visits", {
      header: sortable("Visits"),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("bounceRate", {
      header: sortable("Bounce"),
      cell: ({ getValue }) => formatPercent(getValue()),
      sortUndefined: "last",
      meta: rightAligned,
    }),
    helper.accessor("avgVisitSeconds", {
      header: sortable("Avg. visit"),
      cell: ({ getValue }) => formatDuration(getValue()),
      meta: rightAligned,
    }),
    helper.accessor((row) => row.google?.clicks ?? null, {
      id: "gscClicks",
      header: sortable("GSC clicks"),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatCount(value);
      },
      meta: rightAligned,
    }),
    helper.accessor((row) => row.google?.impressions ?? null, {
      id: "gscImpressions",
      header: sortable("GSC impr."),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatCount(value);
      },
      meta: rightAligned,
    }),
    helper.accessor((row) => row.google?.position ?? null, {
      id: "gscPosition",
      header: sortable("GSC pos."),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatPosition(value);
      },
      meta: rightAligned,
    }),
    helper.accessor((row) => row.bing?.clicks ?? null, {
      id: "bingClicks",
      header: sortable("Bing clicks"),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatCount(value);
      },
      meta: rightAligned,
    }),
    helper.accessor((row) => row.bing?.position ?? null, {
      id: "bingPosition",
      header: sortable("Bing pos."),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatPosition(value);
      },
      meta: rightAligned,
    }),
  ];
}

const ENGINE_NOTES = {
  not_connected: "isn't connected to this project",
  reconnect: "needs to be reconnected",
} as const;

/** Organic landing pages with Search Console and Bing numbers, filterable to
 *  the pages that need attention. */
export function OrganicLandingsTable({ projectId, dates }: AnalyticsTabProps) {
  const query = useQuery(organicLandingsOptions(projectId, dates));
  const [filter, setFilter] = useState<Filter>("all");
  const [text, setText] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const result = query.data;
  const rows = useMemo(() => {
    if (!result?.connected) return [];
    return result.rows.filter(
      (row) =>
        (filter === "all" ||
          (filter === "retention" && row.highImpressionsPoorRetention) ||
          (filter === "unattributed" && row.visitsWithoutGscClicks)) &&
        (!text || row.path.toLowerCase().includes(text.toLowerCase())),
    );
  }, [result, filter, text]);
  const columns = useMemo(() => buildColumns(projectId), [projectId]);
  const table = useDataTable({
    data: rows,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    withSorting: true,
    withPagination: true,
  });

  if (result && !result.connected) {
    return (
      <AnalyticsConnectionLost projectId={projectId} reason={result.reason} />
    );
  }
  const notes = result
    ? [
        result.searchConsole !== "connected"
          ? `Search Console ${ENGINE_NOTES[result.searchConsole]}`
          : null,
        result.bing !== "connected"
          ? `Bing Webmaster Tools ${ENGINE_NOTES[result.bing]}`
          : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="space-y-3">
      {notes.length > 0 ? (
        <Alert variant="info">
          <AlertDescription>
            {notes.join("; ")}, so those columns stay empty. Search Console also
            lags about three days behind Umami.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewSwitch
          label="Landing page filter"
          value={filter}
          items={FILTERS}
          onChange={(next) => {
            setFilter(next);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        />
        <SearchBox
          initial={text}
          placeholder="Filter landing pages…"
          onSubmit={(value) => {
            setText(value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        />
      </div>
      {result?.connected && filter === "retention" ? (
        <p className="text-sm text-muted-foreground">
          Pages with at least {result.thresholds.highImpressions} Google
          impressions whose organic visits bounce{" "}
          {formatPercent(result.thresholds.poorRetentionBounceRate)} of the time
          or more: searchers find them but leave after one page.
        </p>
      ) : null}
      {result?.connected && filter === "unattributed" ? (
        <p className="text-sm text-muted-foreground">
          Pages with organic visits but no Google click: the visits came from
          other engines, or Google hid the query for privacy.
        </p>
      ) : null}
      <DataTable
        table={table}
        isLoading={query.isPending}
        isFiltered={filter !== "all" || Boolean(text)}
        onClearFilters={() => {
          setFilter("all");
          setText("");
        }}
        error={
          query.isError ? (
            <QueryError
              cause={query.error}
              fallback={analyticsErrorMessage(
                query.error,
                "Couldn't load organic landing pages.",
              )}
              onRetry={() => void query.refetch()}
              isRetrying={query.isFetching}
            />
          ) : undefined
        }
        empty={{
          title: "No organic landing pages in this range",
          description:
            "No search engine referred a visit, and Search Console and Bing report no pages for these dates.",
        }}
        footer={
          rows.length > pagination.pageSize ? (
            <TablePagination
              page={pagination.pageIndex + 1}
              pageSize={pagination.pageSize}
              pageSizes={UMAMI_PAGE_SIZES}
              totalCount={rows.length}
              onPageChange={(page) =>
                setPagination((prev) => ({ ...prev, pageIndex: page - 1 }))
              }
              onPageSizeChange={(pageSize) =>
                setPagination({ pageIndex: 0, pageSize })
              }
            />
          ) : undefined
        }
      />
    </div>
  );
}
