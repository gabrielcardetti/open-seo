import { useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { QueryError } from "@/client/components/QueryState";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { TablePagination } from "@/client/components/table/TablePagination";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import {
  AnalyticsConnectionLost,
  SearchBox,
  ViewSwitch,
} from "@/client/features/analytics/AnalyticsParts";
import {
  analyticsErrorMessage,
  breakdownOptions,
  formatDuration,
  formatPercent,
} from "@/client/features/analytics/analyticsQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import type { getUmamiBreakdownTable } from "@/serverFunctions/umamiAnalytics";
import {
  UMAMI_DEFAULT_PAGE_SIZE,
  UMAMI_PAGE_SIZES,
  type UmamiBreakdownType,
} from "@/types/schemas/umami";

type BreakdownRow = Extract<
  Awaited<ReturnType<typeof getUmamiBreakdownTable>>,
  { connected: true }
>["rows"][number];

type View = { value: UmamiBreakdownType; label: string; column: string };

export const PAGE_VIEWS: View[] = [
  { value: "path", label: "Pages", column: "Page" },
  { value: "entry", label: "Entry pages", column: "Entry page" },
  { value: "exit", label: "Exit pages", column: "Exit page" },
  { value: "title", label: "Titles", column: "Title" },
];

export const AUDIENCE_VIEWS: View[] = [
  { value: "country", label: "Country", column: "Country" },
  { value: "region", label: "Region", column: "Region" },
  { value: "city", label: "City", column: "City" },
  { value: "device", label: "Device", column: "Device" },
  { value: "browser", label: "Browser", column: "Browser" },
  { value: "os", label: "OS", column: "Operating system" },
  { value: "language", label: "Language", column: "Language" },
  { value: "screen", label: "Screen", column: "Screen size" },
];

const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

const helper = createColumnHelper<BreakdownRow>();

const count = (value: number | null) =>
  value === null ? "—" : formatCount(value);

/** Columns for Umami rows: expanded rows carry visitors, visits, views,
 *  bounce rate and time; rows from instances older than Umami 3 only a
 *  count. A share bar sits under the first number. */
function breakdownColumns(
  label: string,
  basic: boolean,
  max: number,
): ColumnDef<BreakdownRow>[] {
  const share = (value: number | null) => (
    <span className="relative block">
      <span
        aria-hidden
        className="absolute inset-y-0 right-0 rounded bg-primary/10"
        style={{ width: `${Math.min(100, ((value ?? 0) / max) * 100)}%` }}
      />
      <span className="relative">{count(value)}</span>
    </span>
  );
  const name = helper.accessor("name", {
    enableSorting: false,
    header: () => label,
    cell: ({ getValue }) => (
      <span className="block max-w-xl truncate" title={getValue()}>
        {getValue() || "(none)"}
      </span>
    ),
  });
  if (basic) {
    return [
      name,
      helper.accessor("count", {
        header: ({ column }) => (
          <SortableHeader column={column} label="Count" align="right" />
        ),
        cell: ({ getValue }) => share(getValue()),
        meta: rightAligned,
      }),
    ];
  }
  const numeric = (
    key: "visitors" | "visits" | "pageviews",
    title: string,
    withShare = false,
  ) =>
    helper.accessor(key, {
      header: ({ column }) => (
        <SortableHeader column={column} label={title} align="right" />
      ),
      cell: ({ getValue }) =>
        withShare ? share(getValue()) : count(getValue()),
      sortUndefined: "last",
      meta: rightAligned,
    });
  return [
    name,
    numeric("visitors", "Visitors", true),
    numeric("visits", "Visits"),
    numeric("pageviews", "Views"),
    helper.accessor("bounceRate", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Bounce" align="right" />
      ),
      cell: ({ getValue }) => formatPercent(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("avgVisitSeconds", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Avg. visit" align="right" />
      ),
      cell: ({ getValue }) => formatDuration(getValue()),
      meta: rightAligned,
    }),
  ];
}

/**
 * One Umami breakdown per sub-view (pages, entry and exit pages, titles; or
 * country, region, city, device...), with search and paging. Umami ranks the
 * rows; sorting reorders the rows on the current page.
 */
export function BreakdownTab({
  projectId,
  dates,
  channel,
  search,
  onSearchChange,
  views,
}: AnalyticsTabProps & { views: View[] }) {
  const view = views.find((item) => item.value === search.view) ?? views[0];
  const page = search.page ?? 1;
  const pageSize = search.size ?? UMAMI_DEFAULT_PAGE_SIZE;
  const query = useQuery({
    ...breakdownOptions(projectId, {
      ...dates,
      channel,
      type: view.value,
      search: search.q?.trim().slice(0, 200) || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    placeholderData: keepPreviousData,
  });
  const result = query.data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {views.length > 1 ? (
          <ViewSwitch
            label="Breakdown"
            value={view.value}
            items={views}
            onChange={(next) =>
              onSearchChange({ view: next, page: undefined, q: undefined })
            }
          />
        ) : (
          <span />
        )}
        <SearchBox
          key={`${view.value}-${search.q ?? ""}`}
          initial={search.q ?? ""}
          placeholder={`Filter ${view.label.toLowerCase()}…`}
          onSubmit={(q) =>
            onSearchChange({ q: q || undefined, page: undefined })
          }
        />
      </div>
      {result && !result.connected ? (
        <AnalyticsConnectionLost projectId={projectId} reason={result.reason} />
      ) : (
        <BreakdownTable
          label={view.column}
          rows={result?.rows ?? []}
          basic={result?.detail === "basic"}
          isLoading={query.isPending}
          isFiltered={Boolean(search.q)}
          onClearFilters={() =>
            onSearchChange({ q: undefined, page: undefined })
          }
          error={
            query.isError ? (
              <QueryError
                cause={query.error}
                fallback={analyticsErrorMessage(
                  query.error,
                  "Couldn't load this breakdown from Umami.",
                )}
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
              />
            ) : undefined
          }
          footer={
            result?.connected && (page > 1 || result.hasMore) ? (
              <TablePagination
                page={page}
                pageSize={pageSize}
                pageSizes={UMAMI_PAGE_SIZES}
                totalCount={null}
                hasNextPage={result.hasMore}
                isLoading={query.isFetching}
                onPageChange={(next) => onSearchChange({ page: next })}
                onPageSizeChange={(size) =>
                  onSearchChange({ size, page: undefined })
                }
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}

/** A sortable table of Umami rows. */
function BreakdownTable({
  label,
  rows,
  basic,
  isLoading,
  isFiltered,
  onClearFilters,
  error,
  footer,
  onRowClick,
}: {
  label: string;
  rows: BreakdownRow[];
  basic: boolean;
  isLoading: boolean;
  isFiltered?: boolean;
  onClearFilters?: () => void;
  error?: ReactNode;
  footer?: ReactNode;
  onRowClick?: (row: BreakdownRow) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const max = Math.max(1, ...rows.map((row) => row.visitors ?? row.count ?? 0));
  const columns = useMemo(
    () => breakdownColumns(label, basic, max),
    [label, basic, max],
  );
  const table = useDataTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    withSorting: true,
  });
  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFiltered={isFiltered}
      onClearFilters={onClearFilters}
      error={error}
      footer={footer}
      onRowClick={onRowClick ? (row) => onRowClick(row.original) : undefined}
      empty={{
        title: "Nothing recorded in this range",
        description:
          "Umami has no rows for these dates and filters. Try a longer range or All traffic.",
      }}
    />
  );
}
