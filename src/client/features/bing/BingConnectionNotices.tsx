import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import {
  BING_NOT_CONNECTED_MESSAGES,
  bingConnectionOptions,
} from "@/client/features/bing/bingQueries";

/** Why syncing stopped or failed, for the connection card and the Insights
 *  page header. Nothing when the last sync went fine. */
export function BingSyncProblemAlert({
  connection,
}: {
  connection: {
    canManage: boolean;
    connectorKeyMissing: boolean;
    lastSyncError: string | null;
    outage: { message: string } | null;
  };
}) {
  if (connection.connectorKeyMissing) {
    return (
      <Alert variant="warning">
        <AlertTitle>Syncing has stopped</AlertTitle>
        <AlertDescription>
          The API key this site was connected with has been removed.{" "}
          {connection.canManage
            ? "Save your own key and choose the site again to resume syncing."
            : "Ask an owner or admin to reconnect Bing Webmaster Tools."}
        </AlertDescription>
      </Alert>
    );
  }
  if (connection.outage) {
    // Deployment-wide, and it supersedes the last sync's error, which says
    // the same thing.
    return (
      <Alert variant="warning">
        <AlertTitle>Bing can't be reached right now</AlertTitle>
        <AlertDescription className="break-words">
          {connection.outage.message} Syncs and URL submissions resume on their
          own.
        </AlertDescription>
      </Alert>
    );
  }
  if (connection.lastSyncError) {
    return (
      <Alert variant="warning">
        <AlertTitle>The last sync had a problem</AlertTitle>
        <AlertDescription className="break-words">
          {connection.lastSyncError}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/**
 * A Bing read answered `connected: false` (another member disconnected the
 * project, or Bing stopped accepting the key) while the cached connection
 * still says connected. Says why, and refreshes the connection so the page
 * shows the connect card when the project is no longer connected.
 */
export function BingConnectionLost({
  projectId,
  reason = "not_connected",
  className,
}: {
  projectId: string;
  reason?: keyof typeof BING_NOT_CONNECTED_MESSAGES;
  className?: string;
}) {
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: bingConnectionOptions(projectId).queryKey,
    });
  }, [queryClient, projectId]);
  return (
    <p role="alert" className={cn("text-sm text-destructive", className)}>
      {BING_NOT_CONNECTED_MESSAGES[reason]}
    </p>
  );
}
