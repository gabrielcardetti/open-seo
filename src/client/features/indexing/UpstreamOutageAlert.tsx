import { TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";

/**
 * IndexNow or Bing's API (or the relay in front of them) is unreachable, so
 * sending is paused for every project until a retry gets through, except
 * IndexNow notices that a fallback engine takes. Nothing when both answer.
 */
export function UpstreamOutageAlert({
  outages,
}: {
  outages: Array<{ upstream: string; message: string }>;
}) {
  if (outages.length === 0) return null;
  const indexNowDown = outages.some((outage) => outage.upstream === "indexnow");
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertTitle>
        {indexNowDown && outages.length === 1
          ? "IndexNow is using a fallback"
          : "Sending is paused"}
      </AlertTitle>
      <AlertDescription className="break-words">
        {outages.map((outage) => (
          <p key={outage.upstream}>{outage.message}</p>
        ))}
        {indexNowDown && (
          <p>
            Meanwhile IndexNow notices go straight to Yandex and Yep, which
            share them with Bing and the other engines.
          </p>
        )}
        <p>
          URLs that weren&apos;t sent are not marked failed; the sitemap watch
          sends them once the retry gets through.
        </p>
      </AlertDescription>
    </Alert>
  );
}
