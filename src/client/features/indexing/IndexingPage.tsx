import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { getIndexingSetup } from "@/serverFunctions/indexing";
import { IndexingAutomationCard } from "./IndexingAutomationCard";
import { IndexingLogSection } from "./IndexingLogSection";
import { indexingQueryKeys } from "./indexingShared";
import { IndexNowKeyCard } from "./IndexNowKeyCard";
import { SitemapCandidatesCard } from "./SitemapCandidatesCard";
import { SubmitUrlsCard } from "./SubmitUrlsCard";
import { UpstreamOutageAlert } from "./UpstreamOutageAlert";
import { SitemapsCard } from "@/client/features/sitemaps/SitemapsCard";

export function IndexingPage({ projectId }: { projectId: string }) {
  const setup = useQuery({
    queryKey: indexingQueryKeys.setup(projectId),
    queryFn: () => getIndexingSetup({ data: { projectId } }),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Indexing"
        description="Keep Google and Bing registered with your sitemaps, tell Bing and the other IndexNow engines about new and changed pages, and keep a record of every notice. Google does not take part in IndexNow."
      />
      <SitemapsCard projectId={projectId} />
      <QueryState query={setup} errorFallback="Could not load indexing setup.">
        {(data) => (
          <div className="space-y-6">
            <UpstreamOutageAlert outages={data.outages} />
            <div className="grid gap-6 lg:grid-cols-2">
              <IndexNowKeyCard projectId={projectId} setup={data} />
              <IndexingAutomationCard projectId={projectId} setup={data} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {data.canManage && <SubmitUrlsCard projectId={projectId} />}
              <SitemapCandidatesCard
                projectId={projectId}
                canManage={data.canManage}
              />
            </div>
          </div>
        )}
      </QueryState>
      <IndexingLogSection projectId={projectId} />
    </div>
  );
}
