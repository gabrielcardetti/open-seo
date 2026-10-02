import { queryClient } from "@/client/tanstack-db/queryClient";
import { googleConnectionOptions } from "@/client/features/integrations/googleProviders";
import { createFileRoute } from "@tanstack/react-router";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { CrawlerAccessSettings } from "@/client/features/settings/CrawlerAccessSettings";
import { BingConnectionCard } from "@/client/features/bing/BingConnectionCard";
import { bingConnectionOptions } from "@/client/features/bing/bingQueries";
import { SitemapCoverageNotice } from "@/client/features/sitemaps/SitemapCoverageNotice";

export const Route = createFileRoute(
  "/_app/p/$projectId/settings/integrations",
)({
  loader: ({ params }) => {
    // Start the database checks on link intent without holding up navigation.
    void queryClient.prefetchQuery(
      googleConnectionOptions("gsc", params.projectId),
    );
    void queryClient.prefetchQuery(
      googleConnectionOptions("ga4", params.projectId),
    );
    void queryClient.prefetchQuery(bingConnectionOptions(params.projectId));
  },
  component: ProjectIntegrationsRoute,
});

function ProjectIntegrationsRoute() {
  const { projectId } = Route.useParams();

  return (
    <div className="space-y-8">
      {/* The ids are the targets old #search-console / #google-analytics deep
          links are redirected to from the settings index. Each card's title
          names its integration, so the sections carry no heading. */}
      <section id="search-console" className="scroll-mt-6">
        <GoogleConnectionCard
          provider="gsc"
          projectId={projectId}
          notice={
            <SitemapCoverageNotice projectId={projectId} engine="google" />
          }
        />
      </section>

      <section id="google-analytics" className="scroll-mt-6">
        <GoogleConnectionCard provider="ga4" projectId={projectId} />
      </section>

      <section id="bing-webmaster" className="scroll-mt-6">
        <BingConnectionCard
          projectId={projectId}
          notice={<SitemapCoverageNotice projectId={projectId} engine="bing" />}
        />
      </section>

      <CrawlerAccessSettings projectId={projectId} />
    </div>
  );
}
