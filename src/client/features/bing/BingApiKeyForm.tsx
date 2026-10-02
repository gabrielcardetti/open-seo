import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  bingErrorMessage,
  bingKeyStatusOptions,
} from "@/client/features/bing/bingQueries";
import { saveBingApiKey } from "@/serverFunctions/bing";

const keySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, "Paste the whole API key from Bing Webmaster Tools.")
    .max(200, "That's longer than a Bing API key."),
});

const REJECTED_MESSAGES = {
  invalid_key:
    "Bing didn't accept this key. Copy it again from Bing Webmaster Tools → Settings → API access, or generate a new one there.",
  throttled:
    "Bing is limiting requests for this key right now. Wait a few minutes and save it again.",
  unavailable:
    "Bing Webmaster Tools didn't answer, so the key couldn't be checked. Try again in a moment.",
} as const;

/**
 * Saves the member's Bing Webmaster API key after Bing accepts it. A key
 * belongs to the Bing account, so it serves every site that account verified
 * and every project this member connects.
 */
export function BingApiKeyForm({
  replacing,
  onSaved,
  onCancel,
}: {
  replacing: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (apiKey: string) => saveBingApiKey({ data: { apiKey } }),
  });

  const form = useAppForm({
    defaultValues: { apiKey: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: keySchema },
    onSubmit: async ({ value, formApi }) => {
      let result: Awaited<ReturnType<typeof saveBingApiKey>>;
      try {
        result = await save.mutateAsync(value.apiKey.trim());
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {
              apiKey: bingErrorMessage(error, "Couldn't save the key."),
            },
          },
        });
        return;
      }
      if (!result.ok) {
        formApi.setErrorMap({
          onSubmit: { fields: { apiKey: REJECTED_MESSAGES[result.reason] } },
        });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: bingKeyStatusOptions().queryKey,
      });
      toast.success(
        result.verifiedSiteCount === 1
          ? "API key saved. It can read 1 verified site."
          : `API key saved. It can read ${result.verifiedSiteCount} verified sites.`,
      );
      formApi.reset();
      onSaved();
    },
  });

  return (
    <form.AppForm>
      <form.Form className="space-y-3">
        <form.AppField name="apiKey">
          {(field) => (
            <field.TextField
              label={replacing ? "New API key" : "Bing Webmaster API key"}
              description={
                <>
                  In{" "}
                  <a
                    href="https://www.bing.com/webmasters"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Bing Webmaster Tools
                  </a>
                  , open Settings → API access → API key and choose Generate API
                  key. The key reads every site your Bing account has verified.
                  OpenSEO stores it encrypted.
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
        <div className="flex flex-wrap items-center gap-1">
          <form.SubmitButton size="sm">
            {replacing ? "Replace key" : "Save key"}
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
