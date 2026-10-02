import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  type ColumnDef,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { Search } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Input } from "@/client/components/ui/input";
import {
  BingDrilldownSheet,
  type BingDrilldownTarget,
} from "@/client/features/bing/BingDrilldownSheet";
import {
  bingErrorMessage,
  bingTableOptions,
  formatBingPosition,
  type BingDates,
  type BingTableInput,
} from "@/client/features/bing/bingQueries";
import {
  formatCount,
  formatCtr,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import type { getBingTable } from "@/serverFunctions/bing";
import {
  BING_DEFAULT_PAGE_SIZE,
  BING_PAGE_SIZES,
  BING_STATS_SORTS,
  type BingInsightsSearch,
} from "@/types/schemas/bing";

type BingSort = (typeof BING_STATS_SORTS)[number];
type BingPerformanceRow = Extract<
  Awaited<ReturnType<typeof getBingTable>>,
  { connected: true }
>["rows"][number];

const MAX_SEARCH_LENGTH = 200;

const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

const helper = createColumnHelper<BingPerformanceRow>();

function buildColumns(keyLabel: string): ColumnDef<BingPerformanceRow>[] {
  return [
    helper.accessor("key", {
      enableSorting: false,
      header: () => keyLabel,
      cell: ({ getValue }) => (
        <span className="block max-w-xl truncate" title={getValue()}>
          {getValue()}
        </span>
      ),
    }),
    helper.accessor("clicks", {
      id: "clicks" satisfies BingSort,
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("impressions", {
      id: "impressions" satisfies BingSort,
      header: ({ column }) => (
        <SortableHeader column={column} label="Impressions" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("ctr", {
      id: "ctr" satisfies BingSort,
      header: ({ column }) => (
        <SortableHeader column={column} label="CTR" align="right" />
      ),
      cell: ({ getValue }) => formatCtr(getValue()),
      meta: rightAligned,
    }),
    helper.accessor("avgImpressionPosition", {
      id: "position" satisfies BingSort,
      header: ({ column }) => (
        <SortableHeader column={column} label="Position" align="right" />
      ),
      cell: ({ getValue }) => formatBingPosition(getValue()),
      meta: rightAligned,
    }),
  ];
}

function isSort(value: string): value is BingSort {
  return BING_STATS_SORTS.some((sort) => sort === value);
}

/**
 * Queries, pages or striking-distance queries over the stored history for the
 * page's range. A row opens the live drill-down from Bing.
 */
export function BingPerformanceTab({
  projectId,
  tab,
  dates,
  search,
  onSearchChange,
}: {
  projectId: string;
  tab: "queries" | "pages" | "striking";
  dates: BingDates;
  search: BingInsightsSearch;
  onSearchChange: (update: Partial<BingInsightsSearch>) => void;
}) {
  const [drilldown, setDrilldown] = useState<BingDrilldownTarget | null>(null);
  const dimension = tab === "pages" ? "page" : "query";
  const sort = search.sort ?? "clicks";
  const page = search.page ?? 1;
  const pageSize = search.size ?? BING_DEFAULT_PAGE_SIZE;
  const input: BingTableInput = {
    ...dates,
    dimension,
    // The server takes at most 200 characters; a longer `q` can come from
    // the URL.
    search: search.q?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined,
    ...(tab === "striking" ? { minPosition: 5, maxPosition: 20 } : {}),
    sort,
    page,
    pageSize,
  };
  const tableQuery = useQuery({
    ...bingTableOptions(projectId, input),
    // Hold rows while paging, sorting or filtering. The page remounts this
    // tab per tab, so rows never carry over to another tab's columns.
    placeholderData: keepPreviousData,
  });
  const result = tableQuery.data;
  const rows = result?.connected ? result.rows : [];

  const columns = useMemo(
    () => buildColumns(dimension === "page" ? "Page" : "Query"),
    [dimension],
  );
  const sorting: SortingState = [{ id: sort, desc: sort !== "position" }];
  const table = useDataTable({
    data: rows,
    columns,
    state: { sorting },
    manualSorting: true,
    onSortingChange: (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const id = next[0]?.id ?? "clicks";
      if (isSort(id) && id !== sort) {
        onSearchChange({ sort: id, page: undefined });
      }
    },
  });

  return (
    <div className="space-y-3 p-4">
      {tab === "striking" ? (
        <p className="text-sm text-muted-foreground">
          Queries whose average Bing position is 5 to 20: close to the top
          results, where a better page can move them up.
        </p>
      ) : null}
      <SearchBox
        key={search.q ?? ""}
        initial={search.q ?? ""}
        placeholder={dimension === "page" ? "Filter pages…" : "Filter queries…"}
        onSubmit={(q) => onSearchChange({ q: q || undefined, page: undefined })}
      />
      <DataTable
        table={table}
        isLoading={tableQuery.isPending}
        isFiltered={Boolean(search.q)}
        onClearFilters={() => onSearchChange({ q: undefined, page: undefined })}
        error={
          tableQuery.isError ? (
            <QueryError
              cause={tableQuery.error}
              fallback={bingErrorMessage(
                tableQuery.error,
                "Couldn't load Bing data.",
              )}
              onRetry={() => void tableQuery.refetch()}
              isRetrying={tableQuery.isFetching}
            />
          ) : undefined
        }
        onRowClick={(row) =>
          setDrilldown(
            dimension === "page"
              ? { page: row.original.key }
              : { query: row.original.key },
          )
        }
        empty={{
          title:
            tab === "striking"
              ? "No striking-distance queries"
              : `No ${dimension === "page" ? "pages" : "queries"} in this range`,
          description:
            "Bing reports queries and pages in weekly buckets, a few days behind. Try a longer range.",
        }}
        footer={
          result?.connected && result.totalCount > 0 ? (
            <TablePagination
              page={page}
              pageSize={pageSize}
              pageSizes={BING_PAGE_SIZES}
              totalCount={result.totalCount}
              isLoading={tableQuery.isFetching}
              onPageChange={(next) => onSearchChange({ page: next })}
              onPageSizeChange={(size) =>
                onSearchChange({ size, page: undefined })
              }
            />
          ) : undefined
        }
      />
      <BingDrilldownSheet
        projectId={projectId}
        target={drilldown}
        dates={dates}
        onClose={() => setDrilldown(null)}
      />
    </div>
  );
}

function SearchBox({
  initial,
  placeholder,
  onSubmit,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      role="search"
      className="relative max-w-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        maxLength={MAX_SEARCH_LENGTH}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim() !== initial) onSubmit(value.trim());
        }}
        className="h-8 pl-8"
      />
    </form>
  );
}
