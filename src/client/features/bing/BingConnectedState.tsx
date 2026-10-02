import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import {
  bingConnectionOptions,
  bingErrorMessage,
  bingProjectKey,
} from "@/client/features/bing/bingQueries";
import { BingSyncProblemAlert } from "@/client/features/bing/BingConnectionNotices";
import { BingSyncNowButton } from "@/client/features/bing/BingSyncNowButton";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  disconnectBing,
  setBingSyncEnabled,
  type getBingConnection,
} from "@/serverFunctions/bing";

type BingConnection = Awaited<ReturnType<typeof getBingConnection>>;

const countFormat = new Intl.NumberFormat("en-US");

function nextSyncLabel(nextSyncAt: string | null): string | null {
  if (!nextSyncAt) return null;
  return Date.parse(nextSyncAt) <= Date.now()
    ? "Next sync: within a few minutes"
    : `Next sync ${formatRelativeTime(nextSyncAt)}`;
}

/** The connected site, its sync status and the actions on it. */
export function BingConnectedState({
  projectId,
  connection,
  onChangeSite,
}: {
  projectId: string;
  connection: BingConnection;
  onChangeSite: () => void;
}) {
  const queryClient = useQueryClient();
  const switchId = useId();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const { canManage } = connection;

  const toggleSync = useMutation({
    mutationFn: (enabled: boolean) =>
      setBingSyncEnabled({ data: { projectId, enabled } }),
    onError: (error) => {
      toast.error(bingErrorMessage(error, "Couldn't change the daily sync."));
    },
    onSuccess: ({ syncEnabled }) => {
      toast.success(
        syncEnabled ? "Daily Bing sync turned on" : "Daily Bing sync paused",
      );
      void queryClient.invalidateQueries({
        queryKey: bingConnectionOptions(projectId).queryKey,
      });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectBing({ data: { projectId } }),
    onSuccess: () => {
      setConfirmingDisconnect(false);
      toast.success("Bing Webmaster Tools disconnected from this project");
      void queryClient.invalidateQueries({
        queryKey: bingProjectKey(projectId),
      });
    },
  });

  const lastSync = connection.lastSyncedAt
    ? `Last synced ${formatRelativeTime(connection.lastSyncedAt)}`
    : "Not synced yet. The first sync starts within a few minutes of connecting.";
  const nextSync = connection.syncEnabled
    ? nextSyncLabel(connection.nextSyncAt)
    : "Daily sync is paused";

  return (
    <div className="space-y-4">
      <div className="min-w-0 space-y-1">
        <p className="break-all text-sm font-semibold">{connection.siteUrl}</p>
        {connection.connectedBy ? (
          <p className="break-all text-sm text-muted-foreground">
            Connected by{" "}
            {connection.connectedByCurrentUser ? "you" : connection.connectedBy}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {lastSync}
          {nextSync ? ` · ${nextSync}` : ""}
        </p>
        {connection.quota ? (
          <p className="text-sm text-muted-foreground">
            URL submissions left:{" "}
            {countFormat.format(connection.quota.dailyRemaining ?? 0)} today,{" "}
            {countFormat.format(connection.quota.monthlyRemaining ?? 0)} this
            month
          </p>
        ) : null}
      </div>

      <BingSyncProblemAlert connection={connection} />

      {canManage ? (
        <>
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              size="sm"
              checked={connection.syncEnabled}
              disabled={toggleSync.isPending}
              onCheckedChange={(checked) => toggleSync.mutate(checked)}
            />
            <Label htmlFor={switchId} className="font-normal">
              Sync Bing data every day
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <BingSyncNowButton
              projectId={projectId}
              disabled={connection.connectorKeyMissing}
            />
            <Button variant="outline" size="sm" onClick={onChangeSite}>
              {connection.connectorKeyMissing
                ? "Reconnect"
                : "Change site or key"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmingDisconnect(true)}
            >
              Disconnect project
            </Button>
          </div>
        </>
      ) : null}

      {confirmingDisconnect ? (
        <ConfirmDialog
          title="Disconnect Bing Webmaster Tools?"
          confirmLabel="Disconnect"
          destructive
          pending={disconnect.isPending}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setConfirmingDisconnect(false)}
        >
          OpenSEO stops syncing {connection.siteUrl}. The history synced so far
          stays, and comes back if you connect the same site again.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
