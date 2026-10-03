import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { Cloud, Server } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { umamiErrorMessage } from "@/client/features/umami/umamiQueries";
import { saveUmamiConnection } from "@/serverFunctions/umami";
import type { UmamiMode } from "@/shared/umami";

const cloudSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, "Paste the whole API key from Umami Cloud.")
    .max(200, "That's longer than an Umami API key."),
  baseUrl: z.string(),
  username: z.string(),
  password: z.string(),
});

const selfHostedSchema = z.object({
  apiKey: z.string(),
  baseUrl: z
    .string()
    .trim()
    .min(1, "Enter your Umami address, like https://umami.example.com."),
  username: z.string().trim().min(1, "Enter the Umami username."),
  password: z.string().min(1, "Enter the password."),
});

const REJECTED_FIELD = {
  invalid_url: "baseUrl",
  blocked_url: "baseUrl",
  unreachable: "baseUrl",
  not_umami: "baseUrl",
  auth: "password",
  throttled: "password",
} as const;

const AUTH_MESSAGE = {
  cloud:
    "Umami didn't accept this key. Create a new one in Umami Cloud → Settings → API keys.",
  self_hosted: "Umami didn't accept this username and password.",
} as const;

const linkClass = "underline underline-offset-4 hover:text-foreground";

/**
 * Saves the project's Umami credentials after Umami accepts them: an Umami
 * Cloud API key, or a self-hosted instance address with a login.
 */
export function UmamiCredentialsForm({
  projectId,
  initialMode,
  replacing,
  onSaved,
  onCancel,
}: {
  projectId: string;
  initialMode: UmamiMode;
  replacing: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<UmamiMode>(initialMode);
  return (
    <div className="space-y-4">
      <SegmentedToggle
        showLabels
        value={mode}
        onChange={setMode}
        items={[
          {
            value: "cloud",
            label: "Umami Cloud",
            icon: <Cloud className="size-3.5" />,
          },
          {
            value: "self_hosted",
            label: "Self-hosted",
            icon: <Server className="size-3.5" />,
          },
        ]}
      />
      <CredentialsFields
        key={mode}
        projectId={projectId}
        mode={mode}
        replacing={replacing}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    </div>
  );
}

function CredentialsFields({
  projectId,
  mode,
  replacing,
  onSaved,
  onCancel,
}: {
  projectId: string;
  mode: UmamiMode;
  replacing: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (value: z.infer<typeof cloudSchema>) =>
      saveUmamiConnection({
        data:
          mode === "cloud"
            ? { projectId, mode, apiKey: value.apiKey.trim() }
            : {
                projectId,
                mode,
                baseUrl: value.baseUrl.trim(),
                username: value.username.trim(),
                password: value.password,
              },
      }),
  });

  const form = useAppForm({
    defaultValues: { apiKey: "", baseUrl: "", username: "", password: "" },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: mode === "cloud" ? cloudSchema : selfHostedSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      let result: Awaited<ReturnType<typeof saveUmamiConnection>>;
      try {
        result = await save.mutateAsync(value);
      } catch (error) {
        const field = mode === "cloud" ? "apiKey" : "password";
        formApi.setErrorMap({
          onSubmit: {
            fields: {
              [field]: umamiErrorMessage(
                error,
                "Couldn't save the connection.",
              ),
            },
          },
        });
        return;
      }
      if (!result.ok) {
        const field =
          mode === "cloud" ? "apiKey" : REJECTED_FIELD[result.reason];
        formApi.setErrorMap({
          onSubmit: {
            fields: {
              [field]:
                result.reason === "auth" ? AUTH_MESSAGE[mode] : result.message,
            },
          },
        });
        return;
      }
      toast.success(
        result.websiteCount === 1
          ? "Umami connected. It can read 1 website."
          : `Umami connected. It can read ${result.websiteCount} websites.`,
      );
      formApi.reset();
      onSaved();
    },
  });

  return (
    <form.AppForm>
      <form.Form className="space-y-3">
        {mode === "cloud" ? (
          <form.AppField name="apiKey">
            {(field) => (
              <field.TextField
                label={replacing ? "New API key" : "Umami Cloud API key"}
                description={
                  <>
                    In{" "}
                    <a
                      href="https://cloud.umami.is"
                      target="_blank"
                      rel="noreferrer"
                      className={linkClass}
                    >
                      Umami Cloud → Settings → API keys
                    </a>
                    , create a key and paste it here. OpenSEO stores it
                    encrypted and only reads your analytics.
                  </>
                }
                type="password"
                autoComplete="off"
                data-ph-mask
                className="font-mono"
                required
              />
            )}
          </form.AppField>
        ) : (
          <>
            <form.AppField name="baseUrl">
              {(field) => (
                <field.TextField
                  label="Instance address"
                  description="The https address you open Umami at."
                  placeholder="https://umami.example.com"
                  type="url"
                  autoComplete="off"
                  required
                />
              )}
            </form.AppField>
            <form.AppField name="username">
              {(field) => (
                <field.TextField
                  label="Username"
                  description="A view-only Umami user is enough, and safest."
                  autoComplete="off"
                  data-ph-mask
                  required
                />
              )}
            </form.AppField>
            <form.AppField name="password">
              {(field) => (
                <field.TextField
                  label="Password"
                  description="OpenSEO stores it encrypted."
                  type="password"
                  autoComplete="off"
                  data-ph-mask
                  required
                />
              )}
            </form.AppField>
          </>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <form.SubmitButton size="sm">
            {replacing ? "Save credentials" : "Connect Umami"}
          </form.SubmitButton>
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form.Form>
    </form.AppForm>
  );
}
