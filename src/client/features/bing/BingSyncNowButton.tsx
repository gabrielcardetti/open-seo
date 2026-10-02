import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  bingErrorMessage,
  bingProjectKey,
} from "@/client/features/bing/bingQueries";
import { syncBingNow } from "@/serverFunctions/bing";

function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * Downloads everything Bing serves for the project's site now instead of
 * waiting for the daily sync. Bing limits how often a key may be used, so a
 * second sync within a few minutes is turned away with the wait time.
 */
export function BingSyncNowButton({
  projectId,
  disabled = false,
  size = "sm",
}: {
  projectId: string;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  const queryClient = useQueryClient();
  const sync = useMutation({
    mutationFn: () => syncBingNow({ data: { projectId } }),
    onError: (error) => {
      toast.error(bingErrorMessage(error, "Couldn't sync Bing data."));
    },
    onSuccess: (result) => {
      if (result.status === "not_connected") {
        toast.error(
          "Bing Webmaster Tools isn't connected to this project anymore.",
        );
      } else if (result.status === "too_soon") {
        toast.info(
          `A Bing sync started a moment ago. Try again in ${minutesLabel(result.retryAfterSeconds)}.`,
        );
      } else if (result.stoppedBy === "key") {
        toast.error(
          "Bing stopped accepting the API key for this site, so the sync stopped. Save a new key in Settings → Integrations.",
        );
      } else if (result.stoppedBy === "throttled") {
        toast.error(
          "Bing is limiting requests for this API key right now, so the sync stopped. Try again later.",
        );
      } else if (result.errors.length > 0) {
        toast.warning(
          `Bing data synced, but ${result.errors.length} ${result.errors.length === 1 ? "report" : "reports"} couldn't be downloaded. The rest is up to date.`,
        );
      } else {
        toast.success("Bing data synced");
      }
      void queryClient.invalidateQueries({
        queryKey: bingProjectKey(projectId),
      });
    },
  });

  return (
    <Button
      variant="outline"
      size={size}
      pending={sync.isPending}
      disabled={disabled}
      onClick={() => sync.mutate()}
    >
      {sync.isPending ? null : <RefreshCw data-icon="inline-start" />}
      {sync.isPending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
