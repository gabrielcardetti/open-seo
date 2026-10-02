import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
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
import {
  bingBacklinksOptions,
  bingErrorMessage,
  formatBingDay,
} from "@/client/features/bing/bingQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import { BING_PAGE_SIZES } from "@/types/schemas/bing";

/** The site's pages ranked by the inbound links Bing counted in its newest
 *  weekly snapshot. A page opens the live list of pages linking to it. */
export function BingBacklinksTab({
  projectId,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  projectId: string;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: (typeof BING_PAGE_SIZES)[number]) => void;
}) {
  const [linkedUrl, setLinkedUrl] = useState<string | null>(null);
  const pagesQuery = useQuery({
    ...bingBacklinksOptions(projectId, { page, pageSize }),
    placeholderData: keepPreviousData,
  });
  const result = pagesQuery.data;

  if (pagesQuery.isPending) return <SkeletonTableRows className="p-4" />;
  if (!result) {
    return (
      <div className="p-4">
        <QueryError
          cause={pagesQuery.error}
          fallback={bingErrorMessage(
            pagesQuery.error,
            "Couldn't load Bing backlinks.",
          )}
          onRetry={() => void pagesQuery.refetch()}
          isRetrying={pagesQuery.isFetching}
        />
      </div>
    );
  }
  if (!result.connected || result.mode !== "pages") return null;

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        {result.capturedOn
          ? `Pages with the most links from other sites, as Bing counted them on ${formatBingDay(result.capturedOn)}. OpenSEO refreshes this weekly.`
          : "Bing link counts arrive with the first sync and refresh weekly."}
      </p>
      {result.rows.length > 0 ? (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Inbound links</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.url}>
                  <TableCell className="max-w-xl">
                    <span className="block truncate" title={row.url}>
                      {row.url}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(row.linkCount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setLinkedUrl(row.url)}
                    >
                      Linking pages
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            pageSize={pageSize}
            pageSizes={BING_PAGE_SIZES}
            totalCount={result.totalCount}
            isLoading={pagesQuery.isFetching}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </TableCard>
      ) : null}
      <LinkingPagesSheet
        projectId={projectId}
        url={linkedUrl}
        onClose={() => setLinkedUrl(null)}
      />
    </div>
  );
}

function LinkingPagesSheet({
  projectId,
  url,
  onClose,
}: {
  projectId: string;
  url: string | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const linksQuery = useQuery({
    ...bingBacklinksOptions(projectId, {
      url: url ?? undefined,
      page,
      pageSize: 50,
    }),
    enabled: url !== null,
    placeholderData: keepPreviousData,
  });
  const result = linksQuery.data;
  const links = result?.connected && result.mode === "links" ? result : null;

  return (
    <Sheet
      open={url !== null}
      onOpenChange={(open) => {
        if (open) return;
        setPage(1);
        onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="break-all pr-8">{url}</SheetTitle>
          <SheetDescription>
            Pages on other sites linking here, live from Bing.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-4">
          {linksQuery.isPending ? (
            <SkeletonTableRows columns={2} />
          ) : linksQuery.isError ? (
            <QueryError
              cause={linksQuery.error}
              fallback={bingErrorMessage(
                linksQuery.error,
                "Couldn't load linking pages from Bing.",
              )}
              onRetry={() => void linksQuery.refetch()}
              isRetrying={linksQuery.isFetching}
            />
          ) : !links ? (
            <p role="alert" className="text-sm text-destructive">
              Bing no longer accepts the connection&rsquo;s API key. Reconnect
              Bing Webmaster Tools in Settings → Integrations.
            </p>
          ) : links.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bing lists no linking pages for this URL.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {links.rows.map((link) => (
                  <li
                    key={`${link.sourceUrl} ${link.anchorText ?? ""}`}
                    className="min-w-0 px-3 py-2 text-sm"
                  >
                    <SafeExternalLink
                      url={link.sourceUrl}
                      label={link.sourceUrl}
                      className="block truncate text-primary underline-offset-4 hover:underline"
                    />
                    {link.anchorText ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Anchor: {link.anchorText}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {links.totalPages > 1 ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || linksQuery.isFetching}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-muted-foreground">
                    Page {page} of {links.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= links.totalPages || linksQuery.isFetching}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
