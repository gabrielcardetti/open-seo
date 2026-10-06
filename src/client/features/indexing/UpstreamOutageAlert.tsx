import { TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";

/**
 * IndexNow or Bing's API (or the relay in front of them) is unreachable, so
 * sending is paused for every project until a retry gets through. Nothing
 * when both answer.
 */
export function UpstreamOutageAlert({
  outages,
}: {
  outages: Array<{ upstream: string; message: string }>;
}) {
  if (outages.length === 0) return null;
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertTitle>Sending is paused</AlertTitle>
      <AlertDescription className="break-words">
        {outages.map((outage) => (
          <p key={outage.upstream}>{outage.message}</p>
        ))}
        <p>
          URLs that weren&apos;t sent are not marked failed; the sitemap watch
          sends them once the retry gets through.
        </p>
      </AlertDescription>
    </Alert>
  );
}
