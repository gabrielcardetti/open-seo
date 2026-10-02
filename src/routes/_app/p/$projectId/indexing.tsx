import { createFileRoute } from "@tanstack/react-router";
import { IndexingPage } from "@/client/features/indexing/IndexingPage";

export const Route = createFileRoute("/_app/p/$projectId/indexing")({
  component: IndexingRoute,
});

function IndexingRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <IndexingPage projectId={projectId} />
      </div>
    </div>
  );
}
