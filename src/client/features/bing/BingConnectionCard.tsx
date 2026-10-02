import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { PermissionHint } from "@/client/components/PermissionHint";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { BingApiKeyForm } from "@/client/features/bing/BingApiKeyForm";
import { BingConnectedState } from "@/client/features/bing/BingConnectedState";
import {
  bingConnectionOptions,
  bingErrorMessage,
  bingKeyStatusOptions,
  bingProjectKey,
} from "@/client/features/bing/bingQueries";
import { BingSitePicker } from "@/client/features/bing/BingSitePicker";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { deleteBingApiKey, setBingSite } from "@/serverFunctions/bing";

/**
 * Connects one project to Bing Webmaster Tools: save an API key, pick one of
 * the account's verified sites, then watch the daily sync. Members who can't
 * manage integrations see the connection read-only.
 */
export function BingConnectionCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const connectionQuery = useQuery(bingConnectionOptions(projectId));
  const connection = connectionQuery.data;
  const [changing, setChanging] = useState(false);

  const setSite = useMutation({
    meta: { errorToast: false },
    mutationFn: (siteUrl: string) =>
      setBingSite({ data: { projectId, siteUrl } }),
    onSuccess: () => {
      toast.success(
        "Bing Webmaster Tools connected. The first sync starts within a few minutes.",
      );
      setChanging(false);
      void queryClient.invalidateQueries({
        queryKey: bingProjectKey(projectId),
      });
    },
  });

  return (
    <CardShell
      title="Bing Webmaster Tools"
      icon={<ScanSearch className="size-5 text-[#008373]" />}
      action={
        connection ? (
          <Badge variant={connection.connected ? "success" : "outline"}>
            <span className="size-1.5 rounded-full bg-current" />
            {connection.connected ? "Connected" : "Not connected"}
          </Badge>
        ) : undefined
      }
    >
      {connectionQuery.isPending ? (
        <div
          role="status"
          aria-label="Loading connection"
          className="space-y-3"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-24" />
        </div>
      ) : !connection ? (
        <QueryError
          error={connectionQuery.error}
          fallback="Couldn't check this project's Bing connection."
          onRetry={() => void connectionQuery.refetch()}
          isRetrying={connectionQuery.isFetching}
        />
      ) : connection.connected && !changing ? (
        <BingConnectedState
          projectId={projectId}
          connection={connection}
          onChangeSite={() => {
            setSite.reset();
            setChanging(true);
          }}
        />
      ) : !connection.canManage ? (
        <p className="text-sm text-muted-foreground">
          Bing Webmaster Tools isn&rsquo;t connected to this project yet.
        </p>
      ) : (
        <div className="space-y-5">
          {connection.connected ? null : (
            <p className="text-sm text-muted-foreground">
              See your Bing clicks, impressions, crawl problems and backlinks
              next to Google. Bing also powers Copilot, ChatGPT search and
              DuckDuckGo. OpenSEO syncs once a day and keeps the history, so it
              grows past the six months Bing shows.
            </p>
          )}
          <BingKeySection
            projectId={projectId}
            saving={setSite.isPending}
            onConnect={(siteUrl) => setSite.mutate(siteUrl)}
            onCancel={
              connection.connected ? () => setChanging(false) : undefined
            }
          />
          {setSite.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {bingErrorMessage(setSite.error, "Couldn't connect that site.")}
            </p>
          ) : null}
        </div>
      )}
      {connection && !connection.canManage ? (
        <PermissionHint
          action="change this project's connection"
          className="mt-3"
        />
      ) : null}
    </CardShell>
  );
}

/** The member's key (saved, replaced, removed) and, once saved, the sites it
 *  can read. */
function BingKeySection({
  projectId,
  saving,
  onConnect,
  onCancel,
}: {
  projectId: string;
  saving: boolean;
  onConnect: (siteUrl: string) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const keyQuery = useQuery(bingKeyStatusOptions());
  const [replacing, setReplacing] = useState(false);

  const refreshSites = () =>
    queryClient.invalidateQueries({ queryKey: bingProjectKey(projectId) });

  const removeKey = useMutation({
    mutationFn: () => deleteBingApiKey(),
    onSuccess: () => {
      toast.success("Bing API key removed");
      void queryClient.invalidateQueries({
        queryKey: bingKeyStatusOptions().queryKey,
      });
      void refreshSites();
    },
  });

  if (keyQuery.isPending) {
    return <Skeleton className="h-9 w-full" />;
  }
  if (keyQuery.isError) {
    return (
      <QueryError
        error={keyQuery.error}
        fallback="Couldn't check your Bing API key."
        onRetry={() => void keyQuery.refetch()}
        isRetrying={keyQuery.isFetching}
      />
    );
  }

  const { hasKey, keyHint, verifiedAt } = keyQuery.data;
  if (!hasKey || replacing) {
    return (
      <BingApiKeyForm
        replacing={hasKey}
        onSaved={() => {
          setReplacing(false);
          void refreshSites();
        }}
        onCancel={hasKey ? () => setReplacing(false) : onCancel}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
        <div className="min-w-0 text-sm">
          <p>
            Your API key{" "}
            <span className="font-mono text-muted-foreground">
              ••••{keyHint}
            </span>
          </p>
          {verifiedAt ? (
            <p className="text-xs text-muted-foreground">
              Checked with Bing {formatRelativeTime(verifiedAt)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <InlineConfirm
            label="Remove your Bing API key"
            triggerLabel="Remove"
            pending={removeKey.isPending}
            onConfirm={() => removeKey.mutate()}
          />
        </div>
      </div>
      <BingSitePicker
        projectId={projectId}
        saving={saving}
        onSave={onConnect}
        onCancel={onCancel}
      />
    </div>
  );
}
