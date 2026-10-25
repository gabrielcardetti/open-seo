import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import {
  ChevronRight,
  CircleCheck,
  Download,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { CopyButton } from "@/client/components/CopyButton";
import { PermissionHint } from "@/client/components/PermissionHint";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Alert, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  generateIndexNowKey,
  importIndexNowKey,
  verifyIndexNowKey,
  type getIndexingSetup,
} from "@/serverFunctions/indexing";
import { formatDateTime, indexingQueryKeys } from "./indexingShared";

type Setup = Awaited<ReturnType<typeof getIndexingSetup>>;

const importSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9-]{8,128}$/,
      "8 to 128 characters: letters, digits and dashes.",
    ),
  keyLocation: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || value.startsWith("https://"),
      "Use the full https URL of the key file, or leave it empty.",
    ),
});

function downloadKeyFile(key: string) {
  const url = URL.createObjectURL(new Blob([key], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${key}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Where the key file goes on the common ways sites are built. */
function KeyFileHelp() {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight
          className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
          aria-hidden
        />
        How do I add a file to my site?
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Site built from code: put the file in the folder your site serves
            as-is, often called <code>public</code> or <code>static</code>.
          </li>
          <li>
            WordPress: upload it with your host&apos;s file manager or SFTP to
            the folder that holds <code>wp-config.php</code>.
          </li>
          <li>
            Website builders like Webflow, Shopify, Squarespace and Wix usually
            don&apos;t let you add files at the root. Import the key your
            builder already publishes instead, if it supports IndexNow.
          </li>
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ImportKeyForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useAppForm({
    defaultValues: { key: "", keyLocation: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: importSchema },
    onSubmit: async ({ value, formApi }) => {
      const result = await importIndexNowKey({
        data: {
          projectId,
          key: value.key,
          keyLocation: value.keyLocation || undefined,
        },
      });
      if (!result.ok) {
        formApi.setErrorMap({
          onSubmit: { fields: { keyLocation: result.error } },
        });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: indexingQueryKeys.setup(projectId),
      });
      toast.success("Key imported. Verify it to start using IndexNow.");
      onDone();
    },
  });

  return (
    <form.AppForm>
      <form.Form className="space-y-3">
        <form.AppField name="key">
          {(field) => (
            <field.TextField
              label="Existing key"
              className="font-mono"
              autoComplete="off"
              required
            />
          )}
        </form.AppField>
        <form.AppField name="keyLocation">
          {(field) => (
            <field.TextField
              label="Key file URL (optional)"
              description="Only if the file is not at /{key}.txt on your site's root. IndexNow then accepts only URLs under that file's folder."
              className="font-mono"
              placeholder="https://example.com/keys/your-key.txt"
            />
          )}
        </form.AppField>
        <div className="flex gap-2">
          <form.SubmitButton size="sm">Import key</form.SubmitButton>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

/**
 * The IndexNow key: generate or import it, publish the exact file at its URL,
 * then verify that the site serves it.
 */
export function IndexNowKeyCard({
  projectId,
  setup,
}: {
  projectId: string;
  setup: Setup;
}) {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const { indexNow, canManage } = setup;
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: indexingQueryKeys.setup(projectId),
    });

  const generate = useMutation({
    mutationFn: () => generateIndexNowKey({ data: { projectId } }),
    onSuccess: () => void refresh(),
  });
  const verify = useMutation({
    mutationFn: () => verifyIndexNowKey({ data: { projectId } }),
    onSuccess: (result) => {
      if (result.verified) toast.success("Key file verified");
      void refresh();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>IndexNow key</CardTitle>
        <CardDescription>
          IndexNow shares each notice with Bing, Yandex, Naver, Seznam and other
          participants. Google does not take part.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canManage ? (
          <PermissionHint action="set up IndexNow" />
        ) : importing ? (
          <ImportKeyForm
            projectId={projectId}
            onDone={() => setImporting(false)}
          />
        ) : !indexNow.key ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              pending={generate.isPending}
              disabled={!setup.host}
              onClick={() => generate.mutate()}
            >
              Generate key
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setImporting(true)}
            >
              Import existing key
            </Button>
            {!setup.host && (
              <p className="w-full text-sm text-muted-foreground">
                Set the project&apos;s website domain first.
              </p>
            )}
          </div>
        ) : null}

        {indexNow.key && !importing && (
          <>
            <div className="space-y-2 text-sm">
              <p>
                Publish a plain-text file at this URL containing only the key:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                  {indexNow.keyFileUrl ?? "Set the project's domain first"}
                </code>
                {indexNow.keyFileUrl && (
                  <CopyButton
                    value={indexNow.keyFileUrl}
                    successMessage="Key file URL copied"
                    label="Copy URL"
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                  {indexNow.keyFileContent}
                </code>
                <CopyButton
                  value={indexNow.keyFileContent ?? ""}
                  successMessage="Key copied"
                  label="Copy content"
                />
              </div>
              {!indexNow.verifiedAt && !indexNow.keyLocation && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadKeyFile(indexNow.key ?? "")}
                  >
                    <Download className="size-4" aria-hidden />
                    Download key file
                  </Button>
                  <KeyFileHelp />
                </>
              )}
            </div>

            {indexNow.verifiedAt ? (
              <Alert variant="success">
                <CircleCheck aria-hidden />
                <AlertTitle className="font-normal">
                  Verified {formatDateTime(indexNow.verifiedAt)}
                </AlertTitle>
              </Alert>
            ) : indexNow.lastError ? (
              <Alert variant="warning">
                <TriangleAlert aria-hidden />
                <AlertTitle className="font-normal">
                  {indexNow.lastError}
                </AlertTitle>
              </Alert>
            ) : null}

            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  pending={verify.isPending}
                  onClick={() => verify.mutate()}
                >
                  {indexNow.verifiedAt ? "Verify again" : "Verify key file"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setImporting(true)}
                >
                  Use a different key
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
