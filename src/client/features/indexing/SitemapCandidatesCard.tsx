import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  getIndexingCandidates,
  runIndexingSitemapCheck,
} from "@/serverFunctions/indexing";
import { indexingQueryKeys, summarizeCounts } from "./indexingShared";

const SHOWN_URLS = 20;

function UrlList({
  title,
  urls,
  total,
}: {
  title: string;
  urls: string[];
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {title} ({total.toLocaleString()})
      </p>
      <ul className="space-y-0.5 font-mono text-xs break-all text-muted-foreground">
        {urls.slice(0, SHOWN_URLS).map((url) => (
          <li key={url}>{url}</li>
        ))}
        {total > SHOWN_URLS && <li>…and {total - SHOWN_URLS} more</li>}
      </ul>
    </div>
  );
}

/**
 * A dry run of the sitemap check: read the sitemaps now and show what is new,
 * changed and gone since the stored inventory, then send it on request.
 */
export function SitemapCandidatesCard({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [requested, setRequested] = useState(false);
  const preview = useQuery({
    queryKey: indexingQueryKeys.candidates(projectId),
    queryFn: () => getIndexingCandidates({ data: { projectId } }),
    enabled: requested,
    staleTime: 60_000,
  });
  const run = useMutation({
    mutationFn: () => runIndexingSitemapCheck({ data: { projectId } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.problem);
      } else if (result.baseline) {
        toast.success(
          `Recorded ${result.totalUrls.toLocaleString()} sitemap URLs as the baseline. Nothing was sent.`,
        );
      } else if (result.problem) {
        toast.error(result.problem);
      } else {
        toast.success(summarizeCounts(result.counts));
      }
      void queryClient.invalidateQueries({
        queryKey: indexingQueryKeys.all(projectId),
      });
    },
  });

  const data = preview.data;
  const pending = data?.ok ? data.newCount + data.changedCount : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sitemap changes</CardTitle>
        <CardDescription>
          New URLs and URLs whose lastmod moved since the last check. The first
          check only records the sitemap as a baseline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            pending={preview.isFetching}
            onClick={() =>
              requested ? void preview.refetch() : setRequested(true)
            }
          >
            {data ? "Refresh preview" : "Preview changes"}
          </Button>
          {canManage && (
            <Button
              size="sm"
              pending={run.isPending}
              onClick={() => run.mutate()}
            >
              {data?.ok && data.baseline
                ? "Record baseline"
                : pending > 0
                  ? `Submit these ${pending.toLocaleString()}`
                  : "Check and submit now"}
            </Button>
          )}
        </div>

        {preview.isError && (
          <p className="text-sm text-destructive">
            Could not read the sitemaps.
          </p>
        )}
        {data && !data.ok && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertTitle className="font-normal">{data.problem}</AlertTitle>
          </Alert>
        )}
        {data?.ok && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {data.totalUrls.toLocaleString()} URLs in the sitemaps of{" "}
              {data.origin}
              {data.truncated ? " (capped)" : ""}.{" "}
              {data.baseline
                ? "No inventory yet: the first check records them and sends nothing."
                : `${data.newCount} new, ${data.changedCount} changed, ${data.removedCount} removed.`}
            </p>
            {!data.baseline && (
              <>
                <UrlList
                  title="New"
                  urls={data.newUrls}
                  total={data.newCount}
                />
                <UrlList
                  title="Changed"
                  urls={data.changedUrls}
                  total={data.changedCount}
                />
                <UrlList
                  title="Removed (not sent)"
                  urls={data.removedUrls}
                  total={data.removedCount}
                />
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
