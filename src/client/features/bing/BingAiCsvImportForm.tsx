import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import {
  bingErrorMessage,
  bingProjectKey,
} from "@/client/features/bing/bingQueries";
import { getFieldError } from "@/client/lib/forms";
import { importBingAiCsv } from "@/serverFunctions/bing";

// The server accepts about 5 MB of CSV text.
const MAX_FILE_BYTES = 5_000_000;

const KIND_ITEMS = [
  { value: "auto", label: "Detect from the file" },
  { value: "daily", label: "Citations per day" },
  { value: "pages", label: "Cited pages" },
  { value: "queries", label: "Grounding queries" },
] as const;

const KIND_LABELS = {
  daily: "daily citations",
  pages: "cited pages",
  queries: "grounding queries",
} as const;

const importSchema = z
  .object({
    file: z
      .instanceof(File, { message: "Choose the CSV file you exported." })
      .nullable()
      .refine((file) => file !== null, "Choose the CSV file you exported.")
      .refine(
        (file) => !file || file.size <= MAX_FILE_BYTES,
        "That file is larger than 5 MB. Export a shorter period.",
      ),
    kind: z.enum(["auto", "daily", "pages", "queries"]),
    startDate: z.string(),
    endDate: z.string(),
  })
  .refine((value) => Boolean(value.startDate) === Boolean(value.endDate), {
    message: "Give both the start and the end date, or neither.",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
    { message: "The end date comes before the start date.", path: ["endDate"] },
  );

type ImportResult = Extract<
  Awaited<ReturnType<typeof importBingAiCsv>>,
  { ok: true }
>;

/**
 * Imports a Bing Webmaster "AI Performance" CSV export. Bing has no API for
 * it yet. Importing the same file twice changes nothing.
 */
export function BingAiCsvImportForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const fileInputId = useId();
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  // Bumped after an import so the file input forgets the chosen file.
  const [fileInputKey, setFileInputKey] = useState(0);
  const importCsv = useMutation({
    meta: { errorToast: false },
    mutationFn: async (input: {
      file: File;
      kind: (typeof KIND_ITEMS)[number]["value"];
      startDate: string;
      endDate: string;
    }) =>
      importBingAiCsv({
        data: {
          projectId,
          csv: await input.file.text(),
          kind: input.kind === "auto" ? undefined : input.kind,
          startDate: input.startDate || undefined,
          endDate: input.endDate || undefined,
        },
      }),
  });

  const form = useAppForm({
    defaultValues: {
      file: null as File | null,
      kind: "auto" as (typeof KIND_ITEMS)[number]["value"],
      startDate: "",
      endDate: "",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: importSchema },
    onSubmit: async ({ value, formApi }) => {
      if (!value.file) return;
      setLastImport(null);
      let result: Awaited<ReturnType<typeof importBingAiCsv>>;
      try {
        result = await importCsv.mutateAsync({ ...value, file: value.file });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {
              file: bingErrorMessage(error, "Couldn't import this file."),
            },
          },
        });
        return;
      }
      if (!result.ok) {
        formApi.setErrorMap({
          onSubmit: {
            fields:
              result.reason === "missing_period"
                ? {
                    startDate:
                      "This export has no dates. Give the first and last day of the period you exported.",
                  }
                : {
                    file: `OpenSEO couldn't read this as an AI Performance export. ${result.message}`,
                  },
          },
        });
        return;
      }
      setLastImport(result);
      toast.success(`Imported ${result.imported} rows`);
      void queryClient.invalidateQueries({
        queryKey: [...bingProjectKey(projectId), "ai"],
      });
      formApi.reset();
      setFileInputKey((key) => key + 1);
    },
  });

  return (
    <div className="space-y-3">
      <form.AppForm>
        <form.Form className="grid gap-3 sm:grid-cols-2">
          <form.Field name="file">
            {(field) => {
              const error = getFieldError(field.state.meta.errors);
              return (
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor={fileInputId}>CSV export</FieldLabel>
                  <Input
                    key={fileInputKey}
                    id={fileInputId}
                    type="file"
                    accept=".csv,text/csv"
                    aria-invalid={error ? true : undefined}
                    onChange={(event) =>
                      field.handleChange(event.target.files?.[0] ?? null)
                    }
                  />
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>
              );
            }}
          </form.Field>
          <form.AppField name="kind">
            {(field) => <field.SelectField label="Report" items={KIND_ITEMS} />}
          </form.AppField>
          <form.AppField name="startDate">
            {(field) => (
              <field.TextField
                label="Period start (optional)"
                type="date"
                description="Only for exports without a date column: the first day you exported."
              />
            )}
          </form.AppField>
          <form.AppField name="endDate">
            {(field) => (
              <field.TextField label="Period end (optional)" type="date" />
            )}
          </form.AppField>
          <div className="sm:col-span-2">
            <form.SubmitButton size="sm">Import CSV</form.SubmitButton>
          </div>
        </form.Form>
      </form.AppForm>
      {lastImport ? <ImportSummary result={lastImport} /> : null}
    </div>
  );
}

function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <div role="status" className="rounded-lg border border-border p-3 text-sm">
      <p>
        Imported {result.imported} rows of {KIND_LABELS[result.kind]}.
        {result.skippedCount > 0
          ? ` Skipped ${result.skippedCount} ${result.skippedCount === 1 ? "row" : "rows"}.`
          : ""}
      </p>
      {result.skipped.length > 0 ? (
        <FieldDescription className="mt-2">
          {result.skipped
            .map((row) => `Line ${row.line}: ${row.reason}`)
            .join(" · ")}
        </FieldDescription>
      ) : null}
    </div>
  );
}
