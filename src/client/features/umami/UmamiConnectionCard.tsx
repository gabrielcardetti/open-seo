import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PermissionHint } from "@/client/components/PermissionHint";
import { QueryError } from "@/client/components/QueryState";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { UmamiCredentialsForm } from "@/client/features/umami/UmamiCredentialsForm";
import {
  umamiConnectionOptions,
  umamiErrorMessage,
  umamiProjectKey,
} from "@/client/features/umami/umamiQueries";
import { UmamiWebsitePicker } from "@/client/features/umami/UmamiWebsitePicker";
import {
  disconnectUmami,
  selectUmamiWebsite,
  type getUmamiConnection,
} from "@/serverFunctions/umami";

type UmamiConnection = Awaited<ReturnType<typeof getUmamiConnection>>;

/**
 * Connects one project to an Umami website: save Umami Cloud or self-hosted
 * credentials, then pick a website (the user's own or a team's). Members who
 * can't manage integrations see the connection read-only.
 */
export function UmamiConnectionCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const connectionQuery = useQuery(umamiConnectionOptions(projectId));
  const connection = connectionQuery.data;
  const [changing, setChanging] = useState(false);
  const [editingCredentials, setEditingCredentials] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: umamiProjectKey(projectId) });

  const select = useMutation({
    meta: { errorToast: false },
    mutationFn: (websiteId: string) =>
      selectUmamiWebsite({ data: { projectId, websiteId } }),
    onSuccess: ({ websiteName }) => {
      toast.success(`Umami connected to ${websiteName || "the website"}.`);
      setChanging(false);
      void refresh();
      void queryClient.invalidateQueries({
        queryKey: ["dashboardActivation", projectId],
      });
    },
  });

  return (
    <CardShell
      title="Umami"
      icon={<ChartColumn className="size-5 text-foreground" />}
      action={
        connection ? (
          <Badge variant={connection.connected ? "success" : "outline"}>
            <span className="size-1.5 rounded-full bg-current" />
            {connection.connected ? "Connected" : "Not connected"}
          </Badge>
        ) : undefined
      }
    >
      {connectionQuery.isPending ? (
        <div
          role="status"
          aria-label="Loading connection"
          className="space-y-3"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-24" />
        </div>
      ) : !connection ? (
        <QueryError
          error={connectionQuery.error}
          fallback="Couldn't check this project's Umami connection."
          onRetry={() => void connectionQuery.refetch()}
          isRetrying={connectionQuery.isFetching}
        />
      ) : connection.connected && !changing ? (
        <UmamiConnectedState
          projectId={projectId}
          connection={connection}
          onChange={() => {
            select.reset();
            setChanging(true);
          }}
        />
      ) : !connection.canManage ? (
        <p className="text-sm text-muted-foreground">
          Umami isn&rsquo;t connected to this project yet.
        </p>
      ) : (
        <div className="space-y-5">
          {connection.connected ? null : (
            <p className="text-sm text-muted-foreground">
              Use your Umami analytics in OpenSEO: organic visitors on the
              dashboard, and for agents the landing pages, sources, events and
              search opportunities scored with real visits. Used wherever Google
              Analytics isn&rsquo;t connected.
            </p>
          )}
          {!connection.hasCredentials || editingCredentials ? (
            <UmamiCredentialsForm
              projectId={projectId}
              initialMode={connection.mode ?? "cloud"}
              replacing={connection.hasCredentials}
              onSaved={() => {
                setEditingCredentials(false);
                void refresh();
              }}
              onCancel={
                connection.hasCredentials
                  ? () => setEditingCredentials(false)
                  : undefined
              }
            />
          ) : (
            <>
              <CredentialSummary
                connection={connection}
                onReplace={() => setEditingCredentials(true)}
              />
              <UmamiWebsitePicker
                projectId={projectId}
                saving={select.isPending}
                onSave={(websiteId) => select.mutate(websiteId)}
                onCancel={
                  connection.connected ? () => setChanging(false) : undefined
                }
              />
            </>
          )}
          {select.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {umamiErrorMessage(select.error, "Couldn't use that website.")}
            </p>
          ) : null}
        </div>
      )}
      {connection && !connection.canManage ? (
        <PermissionHint
          action="change this project's connection"
          className="mt-3"
        />
      ) : null}
    </CardShell>
  );
}

function credentialLabel(connection: UmamiConnection): string {
  return connection.mode === "cloud"
    ? `Umami Cloud · API key ••••${connection.credentialHint ?? ""}`
    : `${connection.instanceUrl ?? "Self-hosted"} · user ${connection.credentialHint ?? ""}`;
}

function CredentialSummary({
  connection,
  onReplace,
}: {
  connection: UmamiConnection;
  onReplace: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <p className="min-w-0 break-all text-sm">{credentialLabel(connection)}</p>
      <Button variant="ghost" size="sm" onClick={onReplace}>
        Change
      </Button>
    </div>
  );
}

/** The connected website, where it's read from, and the actions on it. */
function UmamiConnectedState({
  projectId,
  connection,
  onChange,
}: {
  projectId: string;
  connection: UmamiConnection;
  onChange: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => disconnectUmami({ data: { projectId } }),
    onSuccess: () => {
      setConfirmingDisconnect(false);
      toast.success("Umami disconnected from this project");
      void queryClient.invalidateQueries({
        queryKey: umamiProjectKey(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["dashboardActivation", projectId],
      });
    },
  });
  const website = connection.website;

  return (
    <div className="space-y-4">
      <div className="min-w-0 space-y-1">
        <p className="break-all text-sm font-semibold">
          {website?.name || website?.domain || website?.id}
          {website?.domain && website.name ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {website.domain}
            </span>
          ) : null}
        </p>
        <p className="break-all text-sm text-muted-foreground">
          {credentialLabel(connection)}
          {website?.teamId ? " · team website" : ""}
        </p>
        {connection.connectedBy ? (
          <p className="break-all text-sm text-muted-foreground">
            Connected by {connection.connectedBy}
          </p>
        ) : null}
      </div>

      {connection.lastError ? (
        <Alert variant="warning">
          <AlertTitle>Umami refused the last read</AlertTitle>
          <AlertDescription className="break-words">
            {connection.lastError}
          </AlertDescription>
        </Alert>
      ) : null}

      {connection.canManage ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" onClick={onChange}>
            Change website or credentials
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmingDisconnect(true)}
          >
            Disconnect project
          </Button>
        </div>
      ) : null}

      {confirmingDisconnect ? (
        <ConfirmDialog
          title="Disconnect Umami?"
          confirmLabel="Disconnect"
          destructive
          pending={disconnect.isPending}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setConfirmingDisconnect(false)}
        >
          OpenSEO deletes the saved Umami credentials for this project and stops
          reading {website?.name || "the website"}. Your data in Umami
          isn&rsquo;t touched.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
