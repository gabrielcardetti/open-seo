import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getAgentReadiness,
  runAgentReadinessScan,
  updateAgentReadinessConfig,
} from "@/serverFunctions/agent-readiness";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { AgentReadinessChecks } from "./AgentReadinessChecks";

type Profile = "content" | "apiApp";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AgentReadinessPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["agentReadiness", projectId];
  const query = useQuery({
    queryKey,
    queryFn: () => getAgentReadiness({ data: { projectId } }),
  });

  const scan = useMutation({
    mutationFn: () => runAgentReadinessScan({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Scan complete");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The scan failed")),
  });

  const config = useMutation({
    mutationFn: (next: { profile: Profile; scheduleEnabled: boolean }) =>
      updateAgentReadinessConfig({ data: { projectId, ...next } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not save the settings"),
      ),
  });

  if (query.isPending) {
    return <span className="loading loading-spinner loading-md" />;
  }
  if (query.isError) {
    return <p className="text-error">Could not load agent readiness.</p>;
  }

  const { latest, checks, history, domain } = query.data;
  const settings = query.data.config;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agent readiness</h1>
          <p className="text-sm text-base-content/60">
            How well {domain ?? "this site"} can be discovered, read and used by
            AI agents — checked by OpenSEO and by Cloudflare&apos;s scanner.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={scan.isPending || !domain}
          onClick={() => scan.mutate()}
        >
          {scan.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Scan now
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-base-300 p-4">
        <label className="flex items-center gap-2 text-sm">
          Site type
          <select
            className="select select-sm select-bordered"
            value={settings.profile}
            disabled={config.isPending}
            onChange={(event) =>
              config.mutate({
                profile: event.target.value === "apiApp" ? "apiApp" : "content",
                scheduleEnabled: settings.scheduleEnabled,
              })
            }
          >
            <option value="content">Content site</option>
            <option value="apiApp">Product with API / app</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="toggle toggle-sm toggle-primary"
            checked={settings.scheduleEnabled}
            disabled={config.isPending || !domain}
            onChange={(event) =>
              config.mutate({
                profile: settings.profile,
                scheduleEnabled: event.target.checked,
              })
            }
          />
          Scan daily
        </label>
        {settings.scheduleEnabled && (
          <span className="text-xs text-base-content/60">
            Next scan: {formatDate(settings.nextRunAt)}
          </span>
        )}
      </div>

      {!latest ? (
        <p className="text-sm text-base-content/70">
          No scans yet.{" "}
          {domain ? "Run the first one." : "Set the project's domain first."}
        </p>
      ) : (
        <>
          <div className="stats stats-vertical md:stats-horizontal border border-base-300 w-full">
            <div className="stat">
              <div className="stat-title">OpenSEO checks</div>
              <div className="stat-value text-2xl">
                {latest.passed}/{latest.applicable}
              </div>
              <div className="stat-desc">passing, of those that apply</div>
            </div>
            <div className="stat">
              <div className="stat-title">Cloudflare level</div>
              <div className="stat-value text-2xl">
                {latest.cloudflareStatus === "ok" &&
                latest.cloudflareLevel !== null
                  ? `${latest.cloudflareLevel}/5`
                  : "—"}
              </div>
              <div className="stat-desc">
                {latest.cloudflareStatus === "ok"
                  ? "isitagentready.com"
                  : "scanner unavailable for this scan"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-title">Last scan</div>
              <div className="stat-value text-base">
                {formatDate(latest.startedAt)}
              </div>
              <div className="stat-desc">
                {latest.trigger} ·{" "}
                {latest.profile === "content" ? "content site" : "product"}
              </div>
            </div>
          </div>

          {latest.errorMessage && (
            <p className="text-xs text-warning">{latest.errorMessage}</p>
          )}

          <AgentReadinessChecks checks={checks} />
        </>
      )}

      {history.length > 1 && (
        <section className="space-y-2">
          <h3 className="font-semibold">History</h3>
          <div className="overflow-x-auto rounded-lg border border-base-300">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Trigger</th>
                  <th>OpenSEO</th>
                  <th>Cloudflare</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.startedAt)}</td>
                    <td>{entry.trigger}</td>
                    <td>
                      {entry.status === "completed"
                        ? `${entry.passed}/${entry.applicable}`
                        : entry.status}
                    </td>
                    <td>
                      {entry.cloudflareLevel !== null
                        ? `${entry.cloudflareLevel}/5`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
