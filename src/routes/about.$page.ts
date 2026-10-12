import { createFileRoute } from "@tanstack/react-router";
import { aboutPageResponse } from "@/server/lib/aboutPages";

// Public, outside Cloudflare Access (see deploy/alchemy/alchemy.run.ts).
// Handler only, like /r/$reportId.
export const Route = createFileRoute("/about/$page")({
  server: {
    handlers: { GET: ({ params }) => aboutPageResponse(params.page) },
  },
});
