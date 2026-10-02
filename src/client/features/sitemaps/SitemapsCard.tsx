import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { PermissionHint } from "@/client/components/PermissionHint";
import { QueryState } from "@/client/components/QueryState";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { bingProjectKey } from "@/client/features/bing/bingQueries";
import { indexingQueryKeys } from "@/client/features/indexing/indexingShared";
import { submitSitemaps, updateSitemaps } from "@/serverFunctions/sitemaps";
import type { SitemapEngine } from "@/shared/sitemaps";
import { SitemapRow, SitemapSection, TrackedBadges } from "./SitemapRows";
import {
  sitemapsKey,
  sitemapsOptions,
  type SitemapsData,
} from "./sitemapQueries";

type SitemapChanges = Omit<
  Parameters<typeof updateSitemaps>[0]["data"],
  "projectId"
>;

const ENGINE_NAMES = { google: "Google", bing: "Bing" } as const;

const addSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Enter the sitemap's full URL.")
    .startsWith("https://", "Sitemaps must use https."),
});

/**
 * The project's sitemaps: the tracked list with each one's Google and Bing
 * coverage, detected suggestions to confirm, sitemaps only an engine knows,
 * and submitting the missing ones.
 */
export function SitemapsCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(sitemapsOptions(projectId));

  const update = useMutation({
    mutationFn: (changes: SitemapChanges) =>
      updateSitemaps({ data: { projectId, ...changes } }),
    onSuccess: (result) => {
      if (result.detected?.problem) toast.error(result.detected.problem);
      for (const change of result.changes) {
        if (change.problem) toast.error(change.problem);
      }
      void queryClient.invalidateQueries({ queryKey: sitemapsKey(projectId) });
      // The sitemap watch reads the tracked sitemaps.
      void queryClient.invalidateQueries({
        queryKey: indexingQueryKeys.candidates(projectId),
      });
    },
  });
  const { mutate: applyChanges } = update;

  const submit = useMutation({
    mutationFn: (engine: SitemapEngine) =>
      submitSitemaps({
        data: { projectId, engines: [engine], onlyMissing: true },
      }),
    onSuccess: (result, engine) => {
      const outcome = result[engine];
      const name = ENGINE_NAMES[engine];
      if (outcome?.problem) {
        toast.error(outcome.problem);
      } else if (outcome) {
        const sent = outcome.results.filter((r) => r.status === "submitted");
        const failed = outcome.results.find((r) => r.status === "failed");
        if (failed)
          toast.error(failed.detail ?? `${name} refused ${failed.url}`);
        toast.success(
          `Submitted ${sent.length} sitemap${sent.length === 1 ? "" : "s"} to ${name}.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: sitemapsKey(projectId) });
      if (engine === "bing") {
        void queryClient.invalidateQueries({
          queryKey: bingProjectKey(projectId),
        });
      }
    },
  });

  // A project without any sitemap rows gets a first detection on its own, so
  // the card opens with suggestions instead of an empty list.
  const autoDetected = useRef(false);
  const data = query.data;
  useEffect(() => {
    if (!data?.canManage || autoDetected.current) return;
    if (data.tracked.length + data.suggested.length + data.ignored.length > 0)
      return;
    autoDetected.current = true;
    applyChanges({ detect: true });
  }, [data, applyChanges]);

  return (
    <Card id="sitemaps" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>Sitemaps</CardTitle>
        <CardDescription>
          The sitemaps OpenSEO tracks for this site, and whether Google Search
          Console and Bing Webmaster Tools have each one. Detected sitemaps are
          suggestions until you track them.
        </CardDescription>
        {data?.canManage ? (
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              pending={update.isPending && update.variables?.detect === true}
              onClick={() => update.mutate({ detect: true })}
            >
              Detect again
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <QueryState query={query} errorFallback="Could not load sitemaps.">
          {(sitemaps) => (
            <SitemapsBody
              projectId={projectId}
              data={sitemaps}
              busy={update.isPending}
              onChange={(changes) => update.mutate(changes)}
              submitting={submit.isPending ? submit.variables : null}
              onSubmit={(engine) => submit.mutate(engine)}
            />
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function SitemapsBody({
  projectId,
  data,
  busy,
  onChange,
  submitting,
  onSubmit,
}: {
  projectId: string;
  data: SitemapsData;
  busy: boolean;
  onChange: (changes: SitemapChanges) => void;
  submitting: SitemapEngine | null | undefined;
  onSubmit: (engine: SitemapEngine) => void;
}) {
  const { canManage } = data;
  const readOnlyGoogle = data.google.connected && !data.google.canSubmit;
  const rowActions = (url: string) =>
    canManage ? (
      <>
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => onChange({ track: [url] })}
        >
          Track
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => onChange({ ignore: [url] })}
        >
          Ignore
        </Button>
      </>
    ) : null;

  return (
    <div className="space-y-6">
      {readOnlyGoogle ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">
            Search Console is connected with read-only access. Reconnect Search
            Console to let OpenSEO submit sitemaps.
          </AlertTitle>
          <AlertDescription>
            <Link
              to="/p/$projectId/settings/integrations"
              params={{ projectId }}
              hash="search-console"
            >
              Open Search Console settings
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {data.google.problem ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">{data.google.problem}</AlertTitle>
        </Alert>
      ) : null}

      {data.tracked.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tracked sitemaps yet.{" "}
          {data.suggested.length > 0
            ? "Track the suggested ones below to compare them with Google and Bing."
            : "Add your sitemap below."}
        </p>
      ) : null}
      <SitemapSection
        title={`Tracked (${data.tracked.length})`}
        empty={data.tracked.length === 0}
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              {(["google", "bing"] as const).map((engine) => (
                <Button
                  key={engine}
                  size="sm"
                  variant="outline"
                  pending={submitting === engine}
                  disabled={
                    data.missing[engine] === 0 ||
                    !data[engine].connected ||
                    (engine === "google" && readOnlyGoogle)
                  }
                  title={
                    engine === "google" && readOnlyGoogle
                      ? "Reconnect Search Console to let OpenSEO submit sitemaps."
                      : undefined
                  }
                  onClick={() => onSubmit(engine)}
                >
                  Submit missing to {ENGINE_NAMES[engine]} (
                  {data.missing[engine]})
                </Button>
              ))}
            </div>
          ) : null
        }
      >
        {data.tracked.map((row) => (
          <SitemapRow
            key={row.url}
            url={row.url}
            badges={<TrackedBadges row={row} />}
            actions={
              canManage ? (
                <InlineConfirm
                  label={`Stop tracking ${row.url}`}
                  confirmLabel="Stop tracking"
                  pending={busy}
                  onConfirm={() => onChange({ remove: [row.url] })}
                />
              ) : null
            }
          />
        ))}
      </SitemapSection>

      <SitemapSection
        title={`Suggested (${data.suggested.length})`}
        description="Found in robots.txt or at /sitemap.xml. Track the ones that are yours; ignored ones aren't suggested again."
        empty={data.suggested.length === 0}
        action={
          canManage && data.suggested.length > 1 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                onChange({ track: data.suggested.map((row) => row.url) })
              }
            >
              Track all
            </Button>
          ) : null
        }
      >
        {data.suggested.map((row) => (
          <SitemapRow
            key={row.url}
            url={row.url}
            actions={rowActions(row.url)}
          />
        ))}
      </SitemapSection>

      <SitemapSection
        title={`Unknown to OpenSEO (${data.engineOnly.length})`}
        description="Registered in Google or Bing but not tracked here, often an old sitemap. Track it if it's current, or ignore it."
        empty={data.engineOnly.length === 0}
      >
        {data.engineOnly.map((row) => (
          <SitemapRow
            key={row.url}
            url={row.url}
            badges={
              <span className="text-xs text-muted-foreground">
                In{" "}
                {[row.google ? "Google" : null, row.bing ? "Bing" : null]
                  .filter(Boolean)
                  .join(" and ")}
              </span>
            }
            actions={rowActions(row.url)}
          />
        ))}
      </SitemapSection>

      {data.ignored.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Ignored ({data.ignored.length})
          </summary>
          <ul className="divide-y divide-border">
            {data.ignored.map((row) => (
              <SitemapRow
                key={row.url}
                url={row.url}
                actions={
                  canManage ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onChange({ track: [row.url] })}
                    >
                      Track
                    </Button>
                  ) : null
                }
              />
            ))}
          </ul>
        </details>
      ) : null}

      {canManage ? (
        <AddSitemapForm onAdd={(url) => onChange({ add: [url] })} />
      ) : (
        <PermissionHint action="change this project's sitemaps" />
      )}
    </div>
  );
}

function AddSitemapForm({ onAdd }: { onAdd: (url: string) => void }) {
  const form = useAppForm({
    defaultValues: { url: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: addSchema },
    onSubmit: ({ value, formApi }) => {
      onAdd(value.url.trim());
      formApi.reset();
    },
  });
  return (
    <form.AppForm>
      <form.Form className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <form.AppField name="url">
            {(field) => (
              <field.TextField
                label="Add a sitemap"
                placeholder="https://example.com/sitemap-news.xml"
                className="font-mono text-xs"
              />
            )}
          </form.AppField>
        </div>
        <form.SubmitButton size="sm" variant="outline">
          Add
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
