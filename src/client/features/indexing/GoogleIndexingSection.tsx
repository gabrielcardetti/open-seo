import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { StatTile } from "@/client/components/StatTile";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { DailyLineChart } from "@/client/features/bing/BingCharts";
import {
  getIndexingStatus,
  reinspectIndexingUrls,
} from "@/serverFunctions/indexing";
import { searchConsoleInspectionUrl } from "@/shared/gsc";
import {
  INDEXING_PROBLEM_KINDS,
  type IndexingProblemKind,
} from "@/shared/indexing";
import { formatDateTime, indexingQueryKeys } from "./indexingShared";

const SHOWN_TEMPLATES = 15;
const PROBLEM_ROWS = 100;
const ALL = "all";

const PROBLEM_LABELS: Record<IndexingProblemKind, string> = {
  lost_indexing: "Dropped from index",
  noindex: "Noindex",
  fetch_error: "Fetch error",
  canonical_mismatch: "Other canonical",
  not_indexed_after_days: "Not indexed after 7 days",
  inspection_failed: "Inspection failed",
};

const trendConfig = {
  indexed: { label: "Indexed", color: "#14b8a6" },
  notIndexed: { label: "Not indexed", color: "#f59e0b" },
};

function formatCount(value: number) {
  return value.toLocaleString();
}

/** Which sitemap URLs Google has indexed, from the daily URL inspections. */
export function GoogleIndexingSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<IndexingProblemKind | typeof ALL>(ALL);
  const status = useQuery({
    queryKey: [...indexingQueryKeys.googleStatus(projectId), problem],
    queryFn: () =>
      getIndexingStatus({
        data: {
          projectId,
          problem: problem === ALL ? undefined : problem,
          notIndexedDays: 7,
          limit: PROBLEM_ROWS,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const reinspect = useMutation({
    mutationFn: (url: string) =>
      reinspectIndexingUrls({ data: { projectId, urls: [url] } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.problem);
        return;
      }
      if (result.failed > 0)
        toast.error("Search Console could not inspect it.");
      else toast.success("Inspected again.");
      await queryClient.invalidateQueries({
        queryKey: indexingQueryKeys.googleStatus(projectId),
      });
    },
    onError: () => toast.error("Could not inspect the URL."),
  });

  const data = status.data;
  const problemItems = [
    { value: ALL, label: "Any problem" },
    ...INDEXING_PROBLEM_KINDS.map((kind) => ({
      value: kind,
      label: `${PROBLEM_LABELS[kind]} (${data?.problemCounts[kind] ?? 0})`,
    })),
  ];

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Google indexing"
        hint="OpenSEO checks the URLs in your sitemaps with Search Console's URL Inspection every day, within Google's daily quota: new URLs first, then URLs not indexed yet, and indexed ones weekly."
      />
      {status.isError && (
        <p className="text-sm text-destructive">
          Could not load Google indexing.
        </p>
      )}
      {data && !data.siteUrl && (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Connect Search Console to see which of your sitemap URLs Google has
            indexed.
          </CardContent>
        </Card>
      )}
      {data?.siteUrl && (
        <>
          <Card>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <StatTile
                  label="Sitemap URLs"
                  value={formatCount(data.totals.monitored)}
                  hint={`${data.monitor.inspectionsToday}/${data.monitor.dailyBudget} inspections today`}
                />
                <StatTile
                  label="Indexed"
                  value={formatCount(data.totals.indexed)}
                  tone="success"
                />
                <StatTile
                  label="Not indexed"
                  value={formatCount(data.totals.notIndexed)}
                  tone={data.totals.notIndexed > 0 ? "destructive" : undefined}
                />
                <StatTile
                  label="Not inspected yet"
                  value={formatCount(data.totals.notInspected)}
                  hint={`Last run ${formatDateTime(data.monitor.lastRunAt)}`}
                />
              </div>
              {data.monitor.lastError && (
                <p className="text-sm text-destructive">
                  {data.monitor.lastError}
                </p>
              )}
              {data.trend.length > 1 && (
                <DailyLineChart
                  data={data.trend}
                  config={trendConfig}
                  label="Indexed and not indexed sitemap URLs per day"
                  lines={[{ key: "indexed" }, { key: "notIndexed" }]}
                />
              )}
            </CardContent>
          </Card>

          {data.byTemplate.length > 0 && (
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL template</TableHead>
                    <TableHead className="text-right">URLs</TableHead>
                    <TableHead className="text-right">Indexed</TableHead>
                    <TableHead className="text-right">Not indexed</TableHead>
                    <TableHead className="text-right">Not inspected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byTemplate.slice(0, SHOWN_TEMPLATES).map((row) => (
                    <TableRow key={row.template}>
                      <TableCell className="font-mono text-xs">
                        {row.template}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.urls)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.indexed)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.notIndexed)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.notInspected)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Problems ({formatCount(data.problemTotal)})
            </p>
            <Select<IndexingProblemKind | typeof ALL>
              items={problemItems}
              value={problem}
              onValueChange={(next) => {
                if (next !== null) setProblem(next);
              }}
            >
              <SelectTrigger size="sm" aria-label="Problem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {problemItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Problems</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Google canonical</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.problems.map((row) => (
                  <TableRow key={row.url}>
                    <TableCell className="max-w-md">
                      <SafeExternalLink
                        url={searchConsoleInspectionUrl(
                          data.siteUrl ?? "",
                          row.url,
                        )}
                        label={row.url}
                        className="inline-flex items-center gap-1 font-mono text-xs break-all hover:underline"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.kinds.map((kind) => (
                          <Badge key={kind} variant="outline">
                            {PROBLEM_LABELS[kind]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-xs whitespace-normal text-muted-foreground">
                      {row.coverageState ?? row.lastError ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-xs font-mono text-xs break-all text-muted-foreground">
                      {row.googleCanonical &&
                      row.googleCanonical !== row.userCanonical
                        ? row.googleCanonical
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.firstSeenAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={reinspect.isPending}
                        onClick={() => reinspect.mutate(row.url)}
                      >
                        Inspect now
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {data.problems.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      No problems found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableCard>
        </>
      )}
    </section>
  );
}
