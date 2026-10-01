import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  getAgentReadiness,
  runAgentReadinessScan,
  updateAgentReadinessConfig,
} from "@/serverFunctions/agent-readiness";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader, SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { StatTile } from "@/client/components/StatTile";
import { Alert, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { AgentReadinessChecks } from "./AgentReadinessChecks";

type Profile = "content" | "apiApp";

const PROFILE_ITEMS: { value: Profile; label: string }[] = [
  { value: "content", label: "Content site" },
  { value: "apiApp", label: "Product with API / app" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AgentReadinessPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const scheduleSwitchId = useId();
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

  const domain = query.data?.domain ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agent readiness"
        description={
          <>
            How well {domain ?? "this site"} can be discovered, read and used by
            AI agents — checked by OpenSEO and by Cloudflare&apos;s scanner.
          </>
        }
        actions={
          <Button
            size="sm"
            pending={scan.isPending}
            disabled={!domain}
            onClick={() => scan.mutate()}
          >
            Scan now
          </Button>
        }
      />

      <QueryState query={query} errorFallback="Could not load agent readiness.">
        {({ latest, checks, history, config: settings }) => (
          <>
            <Card size="sm">
              <CardContent className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2 text-sm">
                  <span>Site type</span>
                  <Select
                    items={PROFILE_ITEMS}
                    value={settings.profile}
                    disabled={config.isPending}
                    onValueChange={(profile) => {
                      if (profile === null) return;
                      config.mutate({
                        profile,
                        scheduleEnabled: settings.scheduleEnabled,
                      });
                    }}
                  >
                    <SelectTrigger size="sm" aria-label="Site type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROFILE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={scheduleSwitchId}
                    size="sm"
                    checked={settings.scheduleEnabled}
                    disabled={config.isPending || !domain}
                    onCheckedChange={(checked) =>
                      config.mutate({
                        profile: settings.profile,
                        scheduleEnabled: checked,
                      })
                    }
                  />
                  <Label htmlFor={scheduleSwitchId} className="font-normal">
                    Scan daily
                  </Label>
                </div>
                {settings.scheduleEnabled && (
                  <span className="text-xs text-muted-foreground">
                    Next scan: {formatDate(settings.nextRunAt)}
                  </span>
                )}
              </CardContent>
            </Card>

            {!latest ? (
              <EmptyState
                title="No scans yet"
                description={
                  domain
                    ? "Run the first one."
                    : "Set the project's domain first."
                }
              />
            ) : (
              <>
                <Card>
                  <CardContent className="grid gap-4 md:grid-cols-3">
                    <StatTile
                      label="OpenSEO checks"
                      value={`${latest.passed}/${latest.applicable}`}
                      hint="passing, of those that apply"
                    />
                    <StatTile
                      label="Cloudflare level"
                      value={
                        latest.cloudflareStatus === "ok" &&
                        latest.cloudflareLevel !== null
                          ? `${latest.cloudflareLevel}/5`
                          : "—"
                      }
                      hint={
                        latest.cloudflareStatus === "ok"
                          ? "isitagentready.com"
                          : "scanner unavailable for this scan"
                      }
                    />
                    <StatTile
                      label="Last scan"
                      value={formatDate(latest.startedAt)}
                      hint={`${latest.trigger} · ${
                        latest.profile === "content"
                          ? "content site"
                          : "product"
                      }`}
                    />
                  </CardContent>
                </Card>

                {latest.errorMessage && (
                  <Alert variant="warning">
                    <TriangleAlert aria-hidden />
                    <AlertTitle className="font-normal">
                      {latest.errorMessage}
                    </AlertTitle>
                  </Alert>
                )}

                <AgentReadinessChecks checks={checks} />
              </>
            )}

            {history.length > 1 && (
              <section className="space-y-3">
                <SectionHeader title="History" />
                <TableCard>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>OpenSEO</TableHead>
                        <TableHead>Cloudflare</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{formatDate(entry.startedAt)}</TableCell>
                          <TableCell>{entry.trigger}</TableCell>
                          <TableCell className="tabular-nums">
                            {entry.status === "completed"
                              ? `${entry.passed}/${entry.applicable}`
                              : entry.status}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {entry.cloudflareLevel !== null
                              ? `${entry.cloudflareLevel}/5`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableCard>
              </section>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
