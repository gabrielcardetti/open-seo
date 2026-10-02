import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { BingConnectionLost } from "@/client/features/bing/BingConnectionNotices";
import {
  bingErrorMessage,
  bingLiveQueryOptions,
  bingProjectKey,
  formatBingPosition,
  type BingDates,
} from "@/client/features/bing/bingQueries";
import {
  formatCount,
  formatCtr,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { getBingDrilldown } from "@/serverFunctions/bing";

export type BingDrilldownTarget = { page: string } | { query: string };

/**
 * The queries one page ranked for, or the pages that ranked for one query,
 * asked live from Bing. Bing answers from its own window of about six months,
 * so ranges older than that come back empty here even when the tables above
 * show OpenSEO's stored history.
 */
export function BingDrilldownSheet({
  projectId,
  target,
  dates,
  onClose,
}: {
  projectId: string;
  target: BingDrilldownTarget | null;
  dates: BingDates;
  onClose: () => void;
}) {
  const drilldownQuery = useQuery({
    queryKey: [...bingProjectKey(projectId), "drilldown", target, dates],
    queryFn: () =>
      getBingDrilldown({ data: { projectId, ...dates, ...target } }),
    enabled: target !== null,
    ...bingLiveQueryOptions,
  });
  const isPage = target !== null && "page" in target;
  const result = drilldownQuery.data;

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="break-all pr-8">
            {target ? ("page" in target ? target.page : target.query) : ""}
          </SheetTitle>
          <SheetDescription>
            {isPage
              ? "The queries this page appeared for on Bing"
              : "The pages that appeared for this query on Bing"}
            , live from Bing for the selected dates.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {drilldownQuery.isPending ? (
            <SkeletonTableRows columns={4} />
          ) : drilldownQuery.isError ? (
            <QueryError
              cause={drilldownQuery.error}
              fallback={bingErrorMessage(
                drilldownQuery.error,
                "Couldn't load this from Bing.",
              )}
              onRetry={() => void drilldownQuery.refetch()}
              isRetrying={drilldownQuery.isFetching}
            />
          ) : !result?.connected ? (
            <BingConnectionLost projectId={projectId} reason={result?.reason} />
          ) : result.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bing has no data for this in the selected dates. Bing keeps about
              six months, so try a more recent range.
            </p>
          ) : (
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isPage ? "Query" : "Page"}</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">Impr.</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">Pos.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="max-w-56">
                        <span className="block truncate" title={row.key}>
                          {row.key}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCtr(row.ctr)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBingPosition(row.avgImpressionPosition)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
