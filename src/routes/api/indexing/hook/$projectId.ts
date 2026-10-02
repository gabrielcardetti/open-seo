import { createFileRoute } from "@tanstack/react-router";

// Deploy hook: a site's CI calls this after each deploy so new and changed
// URLs are announced to search engines. Authenticated by the project's hook
// secret (Bearer), not by a session.
export const Route = createFileRoute("/api/indexing/hook/$projectId")({
  server: {
    handlers: {
      POST: async ({
        request,
        params,
      }: {
        request: Request;
        params: { projectId: string };
      }) => {
        // Loaded lazily to keep the indexing code out of the fetch path's
        // eager startup graph.
        const { handleDeployHookRequest } =
          await import("@/server/features/indexing/deployHook");
        return handleDeployHookRequest(request, params.projectId);
      },
    },
  },
});
