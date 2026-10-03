import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { AnalyticsPage } from "@/client/features/analytics/AnalyticsPage";
import {
  UMAMI_DEFAULT_PAGE_SIZE,
  umamiAnalyticsSearchSchema,
} from "@/types/schemas/umami";

export const Route = createFileRoute("/_app/p/$projectId/analytics")({
  validateSearch: umamiAnalyticsSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({
        tab: "overview",
        range: "last_28_days",
        channel: "all",
        page: 1,
        size: UMAMI_DEFAULT_PAGE_SIZE,
      }),
    ],
  },
  component: AnalyticsRoute,
});

function AnalyticsRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  return (
    <AnalyticsPage
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
