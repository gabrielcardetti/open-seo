import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { TriangleAlert } from "lucide-react";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { submitUrlsForIndexing } from "@/serverFunctions/indexing";
import {
  INDEXING_CHANNEL_CHOICES,
  MAX_SUBMIT_URLS,
} from "@/types/schemas/indexing";
import { indexingQueryKeys, summarizeCounts } from "./indexingShared";

type ChannelChoice = (typeof INDEXING_CHANNEL_CHOICES)[number];

const CHANNEL_ITEMS: { value: ChannelChoice; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "indexnow", label: "IndexNow" },
  { value: "bing_api", label: "Bing URL submission API" },
];

const splitUrls = (text: string) =>
  text
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean);

const formSchema = z.object({
  urls: z
    .string()
    .refine((text) => splitUrls(text).length > 0, "Paste at least one URL.")
    .refine(
      (text) => splitUrls(text).length <= MAX_SUBMIT_URLS,
      `At most ${MAX_SUBMIT_URLS.toLocaleString()} URLs at once.`,
    ),
  channel: z.enum(INDEXING_CHANNEL_CHOICES),
  force: z.boolean(),
});

export function SubmitUrlsCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const submit = useMutation({
    mutationFn: (value: z.infer<typeof formSchema>) =>
      submitUrlsForIndexing({
        data: {
          projectId,
          urls: splitUrls(value.urls),
          channel: value.channel,
          force: value.force,
        },
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: indexingQueryKeys.all(projectId),
      }),
  });

  const form = useAppForm({
    defaultValues: {
      urls: "",
      channel: "auto" as ChannelChoice,
      force: false,
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value }) => {
      await submit.mutateAsync(value);
    },
  });

  const result = submit.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit URLs</CardTitle>
        <CardDescription>
          One URL per line. &quot;Received&quot; means the engine got the
          notice, not that the page is indexed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form.AppForm>
          <form.Form className="space-y-3">
            <form.AppField name="urls">
              {(field) => (
                <field.TextareaField
                  label="URLs"
                  rows={5}
                  className="font-mono text-xs"
                  placeholder="https://example.com/new-page"
                />
              )}
            </form.AppField>
            <div className="grid gap-3 sm:grid-cols-2">
              <form.AppField name="channel">
                {(field) => (
                  <field.SelectField label="Channel" items={CHANNEL_ITEMS} />
                )}
              </form.AppField>
              <form.AppField name="force">
                {(field) => (
                  <field.CheckboxField
                    label="Send again even if sent recently"
                    description="Ignore the dedupe window."
                  />
                )}
              </form.AppField>
            </div>
            <form.SubmitButton size="sm">Submit</form.SubmitButton>
          </form.Form>
        </form.AppForm>

        {result?.problem ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertTitle className="font-normal">{result.problem}</AlertTitle>
          </Alert>
        ) : result ? (
          <Alert variant={result.results.length > 0 ? "success" : "default"}>
            <AlertTitle className="font-normal">
              {result.results.length > 0
                ? `${summarizeCounts(result.counts)}${result.channel ? ` via ${result.channel === "indexnow" ? "IndexNow" : "Bing API"}` : ""}`
                : "No URL on this project's site to send."}
            </AlertTitle>
            {result.dropped.length > 0 && (
              <AlertDescription>
                Left out {result.dropped.length}:{" "}
                {result.dropped
                  .slice(0, 3)
                  .map((entry) => `${entry.url} (${entry.reason})`)
                  .join(", ")}
                {result.dropped.length > 3 ? "…" : ""}
              </AlertDescription>
            )}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
