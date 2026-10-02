import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { CopyButton } from "@/client/components/CopyButton";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
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
  rotateDeployHookSecret,
  updateIndexingSettings,
  type getIndexingSetup,
} from "@/serverFunctions/indexing";
import { formatDateTime, indexingQueryKeys } from "./indexingShared";

type Setup = Awaited<ReturnType<typeof getIndexingSetup>>;

const DEDUPE_ITEMS = [1, 6, 12, 24, 48, 72, 168].map((hours) => ({
  value: hours,
  label: hours === 168 ? "1 week" : `${hours} h`,
}));

function curlExample(url: string, secret: string) {
  return `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{}'`;
}

/**
 * What runs without anyone clicking: the daily sitemap check, the deploy
 * hook, and announcing pages whose content an audit found changed.
 */
export function IndexingAutomationCard({
  projectId,
  setup,
}: {
  projectId: string;
  setup: Setup;
}) {
  const queryClient = useQueryClient();
  const autoSwitchId = useId();
  const [secret, setSecret] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: indexingQueryKeys.setup(projectId),
    });

  const settings = useMutation({
    mutationFn: (next: { autoSubmitEnabled: boolean; dedupeHours: number }) =>
      updateIndexingSettings({ data: { projectId, ...next } }),
    onSuccess: () => void refresh(),
  });
  const rotate = useMutation({
    mutationFn: () => rotateDeployHookSecret({ data: { projectId } }),
    onSuccess: (result) => {
      setSecret(result.secret);
      void refresh();
    },
  });

  const { canManage, deployHook, sitemap, bing } = setup;
  const channelText =
    setup.autoChannel === "indexnow"
      ? "IndexNow"
      : setup.autoChannel === "bing_api"
        ? "Bing's URL submission API"
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic submission</CardTitle>
        <CardDescription>
          {channelText
            ? `New and changed URLs go out through ${channelText}.`
            : "Verify an IndexNow key or connect Bing Webmaster Tools to send anything."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch
              id={autoSwitchId}
              size="sm"
              checked={setup.autoSubmitEnabled}
              disabled={!canManage || settings.isPending}
              onCheckedChange={(checked) =>
                settings.mutate({
                  autoSubmitEnabled: checked,
                  dedupeHours: setup.dedupeHours,
                })
              }
            />
            <Label htmlFor={autoSwitchId} className="font-normal">
              Check sitemaps daily and after audits
            </Label>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span>Skip URLs sent in the last</span>
            <Select
              items={DEDUPE_ITEMS}
              value={setup.dedupeHours}
              disabled={!canManage || settings.isPending}
              onValueChange={(hours) => {
                if (hours === null) return;
                settings.mutate({
                  autoSubmitEnabled: setup.autoSubmitEnabled,
                  dedupeHours: hours,
                });
              }}
            >
              <SelectTrigger size="sm" aria-label="Dedupe window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEDUPE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Last sitemap check</dt>
            <dd>
              {formatDateTime(sitemap.lastCheckAt)}
              {sitemap.lastError && (
                <span className="block text-destructive">
                  {sitemap.lastError}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Bing URL submission quota</dt>
            <dd>
              {bing
                ? `${bing.dailyQuotaRemaining ?? "?"} today · ${bing.monthlyQuotaRemaining ?? "?"} this month`
                : "Bing not connected"}
            </dd>
          </div>
        </dl>

        <div className="space-y-2">
          <p className="text-sm font-medium">Deploy hook</p>
          <p className="text-sm text-muted-foreground">
            Call it from your deploy pipeline. With no body it checks the
            sitemaps and sends what is new or changed; with{" "}
            <code className="font-mono">{'{"urls": [...]}'}</code> it sends
            those URLs. Repeated deploys are skipped by the window above.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
              POST {deployHook.url}
            </code>
            <CopyButton
              value={deployHook.url}
              successMessage="Hook URL copied"
              label="Copy URL"
            />
          </div>
          {canManage &&
            (deployHook.configured ? (
              <div className="flex items-center gap-2">
                <InlineConfirm
                  label="Rotate deploy hook secret"
                  triggerLabel="Rotate secret"
                  confirmLabel="Rotate — the old secret stops working"
                  pending={rotate.isPending}
                  onConfirm={() => rotate.mutate()}
                />
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                pending={rotate.isPending}
                onClick={() => rotate.mutate()}
              >
                <KeyRound data-icon="inline-start" aria-hidden />
                Create secret
              </Button>
            ))}
          {secret && (
            <Alert variant="info">
              <KeyRound aria-hidden />
              <AlertTitle>
                Copy this secret now. It is shown only once.
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-xs break-all">{secret}</code>
                  <CopyButton value={secret} successMessage="Secret copied" />
                </div>
                <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                  {curlExample(deployHook.url, secret)}
                </pre>
                <CopyButton
                  value={curlExample(deployHook.url, secret)}
                  successMessage="curl command copied"
                  label="Copy curl"
                />
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
