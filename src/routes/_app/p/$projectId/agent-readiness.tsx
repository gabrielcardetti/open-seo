import { createFileRoute } from "@tanstack/react-router";
import { AgentReadinessPage } from "@/client/features/agent-readiness/AgentReadinessPage";

export const Route = createFileRoute("/_app/p/$projectId/agent-readiness")({
  component: AgentReadinessRoute,
});

function AgentReadinessRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <AgentReadinessPage projectId={projectId} />
      </div>
    </div>
  );
}
