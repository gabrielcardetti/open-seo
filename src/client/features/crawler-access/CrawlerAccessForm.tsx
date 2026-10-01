import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { revalidateLogic } from "@tanstack/react-form";
import { useAppForm } from "@/client/components/form/useAppForm";
import { saveCrawlerCredential } from "@/serverFunctions/crawlerAccess";
import {
  CLOUDFLARE_CLIENT_ID_SUFFIX_MESSAGE,
  isCrawlerAccessExpired,
  parseSignatureExpiry,
  type CrawlerAccessProvider,
} from "@/shared/crawler-access";

export const crawlerCredentialsQueryKey = ["crawler-credentials"];
export const saveCrawlerCredentialMutationKey = ["save-crawler-credential"];

// The form holds both providers' fields; each branch validates its own.
const formFields = z.object({
  host: z.string().trim().min(1, "Enter a domain."),
  signatureInput: z.string(),
  signature: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
});

const credentialSchema = z.discriminatedUnion("provider", [
  formFields.extend({
    provider: z.literal("shopify"),
    signatureInput: z
      .string()
      .trim()
      .min(1, "Enter Signature-Input.")
      .refine(
        (value) => !isCrawlerAccessExpired(parseSignatureExpiry(value)),
        "This signature has already expired. Create a new one in Shopify admin.",
      ),
    signature: z.string().trim().min(1, "Enter Signature."),
  }),
  formFields.extend({
    provider: z.literal("cloudflare_access"),
    clientId: z
      .string()
      .trim()
      .min(1, "Enter the Client ID.")
      .refine(
        (value) => value.endsWith(".access"),
        CLOUDFLARE_CLIENT_ID_SUFFIX_MESSAGE,
      ),
    clientSecret: z.string().trim().min(1, "Enter the Client Secret."),
  }),
]);

type CredentialValues = z.infer<typeof formFields> & {
  provider: CrawlerAccessProvider;
};

const providerItems = [
  { value: "shopify", label: "Shopify signature" },
  { value: "cloudflare_access", label: "Cloudflare Access service token" },
] as const;

const emptySecrets = {
  signatureInput: "",
  signature: "",
  clientId: "",
  clientSecret: "",
};

/**
 * The values a site owner copies out of Shopify admin or Cloudflare Zero
 * Trust. Shopify's `Signature-Agent` is a constant we add ourselves, so it is
 * not asked for here.
 */
export function CrawlerAccessForm({
  projectId,
  initialHost,
  lockHost = false,
  provider,
  onSaved,
}: {
  /** The project (website) the credential is stored on. */
  projectId: string;
  initialHost: string;
  lockHost?: boolean;
  /** Fixes the credential type. Without it the user picks one. */
  provider?: CrawlerAccessProvider;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationKey: saveCrawlerCredentialMutationKey,
    // Only the chosen provider's values leave the browser.
    mutationFn: (values: CredentialValues) =>
      saveCrawlerCredential({
        data:
          values.provider === "shopify"
            ? {
                projectId,
                provider: values.provider,
                host: values.host,
                signatureInput: values.signatureInput,
                signature: values.signature,
              }
            : {
                projectId,
                provider: values.provider,
                host: values.host,
                clientId: values.clientId,
                clientSecret: values.clientSecret,
              },
      }),
    onSuccess: async (result) => {
      if ("problem" in result) return;
      await queryClient.invalidateQueries({
        queryKey: crawlerCredentialsQueryKey,
      });
      toast.success(`Crawler access saved for ${result.credential.host}`);
      onSaved?.();
    },
  });

  const form = useAppForm({
    defaultValues: {
      provider: provider ?? ("shopify" as CrawlerAccessProvider),
      host: initialHost,
      ...emptySecrets,
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: credentialSchema },
    onSubmit: async ({ value, formApi }) => {
      const result = await saveMutation.mutateAsync(value);
      if ("problem" in result) {
        const { problem } = result;
        formApi.setErrorMap({
          onSubmit: {
            fields:
              problem.reason === "access_denied"
                ? {
                    clientId: `Cloudflare Access sent this token to its login page on ${problem.host}. Check that a Service Auth policy includes it and that both values were copied in full.`,
                  }
                : {
                    signatureInput:
                      problem.reason === "wrong_domain"
                        ? `This signature was created for ${problem.signedHost}, not ${problem.host}. In Shopify admin, create a signature for ${problem.host}.`
                        : `Shopify won't accept this signature for ${problem.host}. Check that you created it for ${problem.host} and copied both values in full.`,
                  },
          },
        });
        return;
      }
      formApi.reset({ ...value, ...emptySecrets });
    },
  });

  return (
    <form.AppForm>
      <form.Form className="space-y-3">
        {!provider ? (
          <form.AppField name="provider">
            {(field) => (
              <field.SelectField label="Type" items={providerItems} />
            )}
          </form.AppField>
        ) : null}
        {!lockHost ? (
          <form.AppField name="host">
            {(field) => (
              <field.TextField
                label="Domain"
                placeholder="store.example.com"
                className="font-mono"
                required
              />
            )}
          </form.AppField>
        ) : null}
        <form.Subscribe selector={(state) => state.values.provider}>
          {(selected) =>
            selected === "cloudflare_access" ? (
              <>
                <form.AppField name="clientId">
                  {(field) => (
                    <field.TextField
                      label="Client ID"
                      autoComplete="off"
                      data-ph-mask
                      className="font-mono"
                      placeholder="….access"
                      required
                    />
                  )}
                </form.AppField>
                <form.AppField name="clientSecret">
                  {(field) => (
                    <field.TextField
                      label="Client Secret"
                      description="The token must be included in an Access policy whose action is Service Auth."
                      type="password"
                      autoComplete="off"
                      data-ph-mask
                      className="font-mono"
                      required
                    />
                  )}
                </form.AppField>
              </>
            ) : (
              <>
                <form.AppField name="signatureInput">
                  {(field) => (
                    <field.TextField
                      label="Signature-Input"
                      type="password"
                      autoComplete="off"
                      data-ph-mask
                      className="font-mono"
                      placeholder="sig1=(...);expires=..."
                      required
                    />
                  )}
                </form.AppField>
                <form.AppField name="signature">
                  {(field) => (
                    <field.TextField
                      label="Signature"
                      description="Shopify also shows a Signature-Agent value. You don't need to paste it: OpenSEO sends it with every request."
                      type="password"
                      autoComplete="off"
                      data-ph-mask
                      className="font-mono"
                      placeholder="sig1=:...:"
                      required
                    />
                  )}
                </form.AppField>
              </>
            )
          }
        </form.Subscribe>
        <form.SubmitButton disabled={!projectId}>Save</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
