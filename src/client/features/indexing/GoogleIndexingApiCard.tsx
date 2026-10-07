import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { CopyButton } from "@/client/components/CopyButton";
import { PermissionHint } from "@/client/components/PermissionHint";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  checkGoogleIndexing,
  removeGoogleIndexing,
  saveGoogleIndexing,
  type getIndexingSetup,
} from "@/serverFunctions/indexing";
import type { GoogleIndexingStatus } from "@/shared/indexing";
import { formatDateTime, indexingQueryKeys } from "./indexingShared";

type Setup = Awaited<ReturnType<typeof getIndexingSetup>>;
type GoogleIndexing = Setup["googleIndexing"];

const STATUS_BADGES = {
  ok: { label: "Working", variant: "success" },
  not_configured: { label: "Not set up", variant: "outline" },
  invalid_key: { label: "Invalid key", variant: "destructive" },
  api_disabled: { label: "API not enabled", variant: "warning" },
  not_owner: { label: "Not an owner", variant: "warning" },
  quota_exceeded: { label: "Quota exceeded", variant: "warning" },
  error: { label: "Check failed", variant: "destructive" },
} as const satisfies Record<
  GoogleIndexingStatus,
  { label: string; variant: string }
>;

const formSchema = z.object({
  serviceAccountJson: z.string(),
  sampleUrl: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^https?:\/\//i.test(value),
      "Use a full URL, or leave it empty for the home page.",
    ),
});

function KeyForm({
  projectId,
  current,
  onDone,
}: {
  projectId: string;
  current: GoogleIndexing;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const replacing = current.status !== "not_configured";
  const form = useAppForm({
    defaultValues: {
      serviceAccountJson: "",
      sampleUrl: current.customSampleUrl ?? "",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value, formApi }) => {
      const result = await saveGoogleIndexing({
        data: {
          projectId,
          serviceAccountJson: value.serviceAccountJson || undefined,
          sampleUrl: value.sampleUrl || null,
        },
      });
      if (!result.ok) {
        formApi.setErrorMap({
          onSubmit: { fields: { [result.field]: result.error } },
        });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: indexingQueryKeys.setup(projectId),
      });
      toast.success(
        result.googleIndexing.status === "ok"
          ? "Saved. The connection works."
          : "Saved. See what is still missing.",
      );
      onDone();
    },
  });

  return (
    <form.AppForm>
      <form.Form className="space-y-3">
        <form.AppField name="serviceAccountJson">
          {(field) => (
            <field.TextareaField
              label="Service account JSON key"
              description={
                replacing
                  ? "Leave empty to keep the saved key. It is stored encrypted and never shown again."
                  : "The whole key file from Google Cloud. It is stored encrypted and never shown again."
              }
              className="h-32 font-mono text-xs"
              placeholder='{ "type": "service_account", ... }'
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </form.AppField>
        <form.AppField name="sampleUrl">
          {(field) => (
            <field.TextField
              label="Sample URL (optional)"
              description="A page on your site to check ownership with, ideally a job posting. Empty means the home page."
              className="font-mono"
              placeholder={current.sampleUrl ?? "https://example.com/jobs/1"}
            />
          )}
        </form.AppField>
        <div className="flex gap-2">
          <form.SubmitButton size="sm">Save and check</form.SubmitButton>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

function StatusDetails({ google }: { google: GoogleIndexing }) {
  const ok = google.status === "ok";
  return (
    <Alert
      variant={
        ok ? "success" : google.status === "not_configured" ? "info" : "warning"
      }
    >
      {ok ? <CircleCheck aria-hidden /> : <TriangleAlert aria-hidden />}
      <AlertTitle className="font-normal">{google.reason}</AlertTitle>
      {google.steps.length > 0 && (
        <AlertDescription>
          <ol className="list-decimal space-y-1 pl-4">
            {google.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {google.fixUrl && (
            <SafeExternalLink
              url={google.fixUrl}
              label={
                google.status === "api_disabled"
                  ? "Enable the API in Google Cloud"
                  : "Open Search Console users"
              }
              className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-4"
            />
          )}
        </AlertDescription>
      )}
    </Alert>
  );
}

/**
 * Google's Indexing API: the project's service account and whether Google
 * accepts it. OpenSEO only checks the connection; the site sends the
 * notifications for its job-posting pages.
 */
export function GoogleIndexingApiCard({
  projectId,
  setup,
}: {
  projectId: string;
  setup: Setup;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const { googleIndexing: google, canManage } = setup;
  const configured = google.status !== "not_configured";
  const badge = STATUS_BADGES[google.status];
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: indexingQueryKeys.setup(projectId),
    });

  const check = useMutation({
    mutationFn: () => checkGoogleIndexing({ data: { projectId } }),
    onSuccess: (result) => {
      if (result.status === "ok") toast.success("The connection works");
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => removeGoogleIndexing({ data: { projectId } }),
    onSuccess: () => {
      setConfirmingRemove(false);
      void refresh();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Google Indexing API
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </CardTitle>
        <CardDescription>
          Only for pages with JobPosting or BroadcastEvent structured data.
          Google may ignore other pages sent through it, or treat that use as
          spam. OpenSEO checks the service account; your site sends the
          notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configured && (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Service account</span>
              <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                {google.clientEmail}
              </code>
              {google.clientEmail && (
                <CopyButton
                  value={google.clientEmail}
                  successMessage="Email copied"
                  label="Copy email"
                />
              )}
            </div>
            <p className="text-muted-foreground">
              Checked with{" "}
              <span className="font-mono break-all">{google.sampleUrl}</span>
              {google.lastCheckedAt &&
                ` · last check ${formatDateTime(google.lastCheckedAt)}`}
              {google.statusChangedAt &&
                ` · ${google.status === "ok" ? "working" : "failing"} since ${formatDateTime(google.statusChangedAt)}`}
            </p>
          </div>
        )}

        {!editing && <StatusDetails google={google} />}

        {!canManage ? (
          <PermissionHint action="set up the Google Indexing API" />
        ) : editing ? (
          <KeyForm
            projectId={projectId}
            current={google}
            onDone={() => setEditing(false)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {configured ? (
              <>
                <Button
                  size="sm"
                  pending={check.isPending}
                  onClick={() => check.mutate()}
                >
                  Check now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  Edit key or URL
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingRemove(true)}
                >
                  Remove
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing(true)}>
                Add service account key
              </Button>
            )}
          </div>
        )}
      </CardContent>
      {confirmingRemove && (
        <ConfirmDialog
          title="Remove the Google Indexing API key?"
          confirmLabel="Remove"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirmingRemove(false)}
        >
          OpenSEO deletes the saved service account key and stops checking it.
          Nothing changes in Google Cloud or Search Console.
        </ConfirmDialog>
      )}
    </Card>
  );
}
