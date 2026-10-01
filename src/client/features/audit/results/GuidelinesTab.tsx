import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGuidelineResults } from "@/serverFunctions/audit";
import { QueryState } from "@/client/components/QueryState";
import { Spinner } from "@/client/components/ui/spinner";
import { GuidelinesView } from "@/client/features/audit/results/GuidelinesView";

/**
 * Loads the guideline evaluation on its own, only when the tab is opened.
 *
 * Deliberately not folded into `getAuditResults`: that call already returns
 * every page, Lighthouse row and issue for the audit in one unpaginated
 * payload, and most audits have no guideline evaluation at all.
 */
export function GuidelinesTab({
  projectId,
  auditId,
  tabs,
}: {
  projectId: string;
  auditId: string;
  tabs: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["guidelineResults", projectId, auditId],
    queryFn: () => getGuidelineResults({ data: { projectId, auditId } }),
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {tabs}
      <div className="p-4">
        <QueryState
          query={query}
          errorFallback="Could not load the guideline evaluation."
          loading={
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner />
              Loading content guideline verdicts…
            </div>
          }
        >
          {(data) => (
            <GuidelinesView
              evaluations={data?.evaluations ?? []}
              results={data?.results ?? []}
            />
          )}
        </QueryState>
      </div>
    </div>
  );
}
