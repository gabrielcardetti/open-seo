import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { StatTile } from "@/client/components/StatTile";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { BingAiCsvImportForm } from "@/client/features/bing/BingAiCsvImportForm";
import { BingCitationsChart } from "@/client/features/bing/BingCharts";
import {
  bingAiCitationsOptions,
  bingErrorMessage,
  type BingDates,
} from "@/client/features/bing/bingQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

function ImportHelp() {
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>
        Bing shows how often Copilot and Bing&rsquo;s AI answers cite your site
        in Bing Webmaster Tools → AI Performance, but it has no API for it yet.
        Export the report there as CSV (citations per day, cited pages, or
        grounding queries) and import it here. Each import adds to the history;
        importing the same file twice changes nothing.
      </p>
    </div>
  );
}

function TopTable({
  keyLabel,
  rows,
}: {
  keyLabel: string;
  rows: Array<{ key: string; citations: number }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        None imported for these dates.
      </p>
    );
  }
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{keyLabel}</TableHead>
            <TableHead className="text-right">Citations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="max-w-md">
                <span className="block truncate" title={row.key}>
                  {row.key}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.citations)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

/** AI citations from imported AI Performance exports, and the import. */
export function BingAiCitationsTab({
  projectId,
  dates,
  canImport,
}: {
  projectId: string;
  dates: BingDates;
  canImport: boolean;
}) {
  const citationsQuery = useQuery(bingAiCitationsOptions(projectId, dates));

  if (citationsQuery.isPending) return <SkeletonTableRows className="p-4" />;
  if (citationsQuery.isError) {
    return (
      <div className="p-4">
        <QueryError
          cause={citationsQuery.error}
          fallback={bingErrorMessage(
            citationsQuery.error,
            "Couldn't load AI citations.",
          )}
          onRetry={() => void citationsQuery.refetch()}
          isRetrying={citationsQuery.isFetching}
        />
      </div>
    );
  }
  const citations = citationsQuery.data;
  const importForm = canImport ? (
    <BingAiCsvImportForm projectId={projectId} />
  ) : (
    <p className="text-sm text-muted-foreground">
      An owner or admin can import AI Performance exports.
    </p>
  );

  if (!citations.hasData) {
    return (
      <div className="max-w-3xl space-y-4 p-4">
        <h3 className="text-sm font-semibold">
          No AI citation data for these dates
        </h3>
        <ImportHelp />
        {importForm}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label="AI citations"
          value={formatCount(citations.totalCitations)}
        />
      </div>
      {citations.daily.length > 0 ? (
        <BingCitationsChart data={citations.daily} />
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Top cited pages</h3>
          <TopTable
            keyLabel="Page"
            rows={citations.topPages.map((row) => ({
              key: row.url,
              citations: row.citations,
            }))}
          />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Top grounding queries</h3>
          <TopTable
            keyLabel="Query"
            rows={citations.topQueries.map((row) => ({
              key: row.query,
              citations: row.citations,
            }))}
          />
        </section>
      </div>
      <Collapsible className="space-y-3 rounded-lg border border-border p-3">
        <CollapsibleTrigger
          render={<Button variant="ghost" size="sm" className="-ml-1" />}
        >
          Import another export
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3">
          <ImportHelp />
          {importForm}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
