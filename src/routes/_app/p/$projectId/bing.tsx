import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { BingInsightsPage } from "@/client/features/bing/BingInsightsPage";
import {
  BING_DEFAULT_PAGE_SIZE,
  bingInsightsSearchSchema,
} from "@/types/schemas/bing";

export const Route = createFileRoute("/_app/p/$projectId/bing")({
  validateSearch: bingInsightsSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({
        tab: "queries",
        range: "last_28_days",
        sort: "clicks",
        page: 1,
        size: BING_DEFAULT_PAGE_SIZE,
      }),
    ],
  },
  component: BingInsightsRoute,
});

function BingInsightsRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  return (
    <BingInsightsPage
      projectId={projectId}
      search={search}
      onSearchChange={(update) => {
        void navigate({
          search: (prev) => ({ ...prev, ...update }),
          replace: true,
        });
      }}
    />
  );
}
