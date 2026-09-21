import { createFileRoute } from "@tanstack/react-router";
import { AgentReadinessPage } from "@/client/features/agent-readiness/AgentReadinessPage";

export const Route = createFileRoute("/_project/p/$projectId/agent-readiness")({
  component: AgentReadinessRoute,
});

function AgentReadinessRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="h-full overflow-auto bg-base-100">
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 py-8 pb-24 sm:p-6 md:py-12 md:pb-12">
        <AgentReadinessPage projectId={projectId} />
      </div>
    </div>
  );
}
