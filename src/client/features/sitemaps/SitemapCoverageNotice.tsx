import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertTitle } from "@/client/components/ui/alert";
import type { SitemapEngine } from "@/shared/sitemaps";
import { sitemapsOptions } from "./sitemapQueries";

const ENGINE_NAMES = { google: "Google", bing: "Bing" } as const;

/**
 * A one-line warning for a connected Search Console or Bing card: tracked
 * sitemaps the engine doesn't have, or suggestions nobody has reviewed.
 * Links to the Sitemaps card on the Indexing page. Renders nothing when
 * there is nothing to do or the read fails.
 */
export function SitemapCoverageNotice({
  projectId,
  engine,
}: {
  projectId: string;
  engine: SitemapEngine;
}) {
  const { data } = useQuery({
    ...sitemapsOptions(projectId),
    staleTime: 5 * 60_000,
  });
  if (!data) return null;
  const missing = data.missing[engine];
  const message =
    missing > 0 && engine === "bing" && data.bing.stale
      ? `Bing data is out of date: ${missing} tracked sitemap${missing === 1 ? " wasn't" : "s weren't"} in its last sync. Sync Bing before submitting.`
      : missing > 0
        ? `${missing} tracked sitemap${missing === 1 ? " isn't" : "s aren't"} registered in ${ENGINE_NAMES[engine]}.`
        : data.tracked.length === 0 && data.suggestedCount > 0
          ? `Review ${data.suggestedCount} suggested sitemap${data.suggestedCount === 1 ? "" : "s"} so OpenSEO can check ${ENGINE_NAMES[engine]} has them.`
          : null;
  if (!message) return null;
  return (
    <Alert variant="warning" className="mt-4">
      <TriangleAlert aria-hidden />
      <AlertTitle className="font-normal">
        {message}{" "}
        <Link
          to="/p/$projectId/indexing"
          params={{ projectId }}
          hash="sitemaps"
        >
          Review sitemaps
        </Link>
      </AlertTitle>
    </Alert>
  );
}
