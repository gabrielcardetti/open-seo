import { useQuery } from "@tanstack/react-query";
import { getGuidelineResults } from "@/serverFunctions/audit";
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
}: {
  projectId: string;
  auditId: string;
}) {
  const query = useQuery({
    queryKey: ["guidelineResults", projectId, auditId],
    queryFn: () => getGuidelineResults({ data: { projectId, auditId } }),
  });

  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-base-content/70">
        <span className="loading loading-spinner loading-sm" />
        Loading content guideline verdicts…
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="text-sm text-error py-6">
        Could not load the guideline evaluation.
      </p>
    );
  }

  return (
    <GuidelinesView
      evaluations={query.data?.evaluations ?? []}
      results={query.data?.results ?? []}
    />
  );
}
