import { useState } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Card } from "@/client/components/ui/card";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import { BarList, LiveRead } from "@/client/features/analytics/AnalyticsParts";
import {
  attributionOptions,
  journeyOptions,
} from "@/client/features/analytics/analyticsQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

const UNAVAILABLE =
  "This report isn't available on this Umami version (it needs Umami 3).";

const journeySchema = z.object({
  steps: z.enum(["3", "4", "5", "6", "7"]),
  startStep: z.string().trim().max(500),
});

const STEP_COUNTS = (["3", "4", "5", "6", "7"] as const).map((value) => ({
  value,
  label: `${value} steps`,
}));

/** The most common sequences of pages and events, optionally from a start
 *  page or event (Umami's journey report). */
export function JourneyPanel({ projectId, dates, channel }: AnalyticsTabProps) {
  const [input, setInput] = useState<{
    steps: number;
    startStep?: string;
  } | null>(null);
  const form = useAppForm({
    defaultValues: { steps: "5" as "3" | "4" | "5" | "6" | "7", startStep: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: journeySchema },
    onSubmit: ({ value }) =>
      setInput({
        steps: Number(value.steps),
        startStep: value.startStep.trim() || undefined,
      }),
  });
  const query = useQuery({
    ...journeyOptions(projectId, {
      ...dates,
      channel,
      steps: input?.steps ?? 5,
      startStep: input?.startStep,
    }),
    enabled: input !== null,
  });

  return (
    <div className="space-y-4">
      <form.AppForm>
        <form.Form className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_auto]">
          <form.AppField name="steps">
            {(field) => (
              <field.SelectField label="Length" items={STEP_COUNTS} />
            )}
          </form.AppField>
          <form.AppField name="startStep">
            {(field) => (
              <field.TextField
                label="Start at (optional)"
                placeholder="/ or an event name"
              />
            )}
          </form.AppField>
          <form.SubmitButton size="sm">Show journeys</form.SubmitButton>
        </form.Form>
      </form.AppForm>
      {input ? (
        <Card className="p-4">
          <LiveRead
            projectId={projectId}
            query={query}
            fallback="Couldn't run the journey report in Umami."
          >
            {(result) =>
              !result.available ? (
                <p className="text-sm text-muted-foreground">{UNAVAILABLE}</p>
              ) : result.paths.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No journeys recorded for these dates.
                </p>
              ) : (
                <ol className="space-y-2">
                  {result.paths.map((path, index) => (
                    <li
                      key={index}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-1">
                        {path.steps.map((step, stepIndex) => (
                          <span
                            key={stepIndex}
                            className="flex items-center gap-1"
                          >
                            {stepIndex > 0 ? (
                              <span className="text-muted-foreground">→</span>
                            ) : null}
                            <span className="rounded bg-muted px-1.5 py-0.5 break-all">
                              {step}
                            </span>
                          </span>
                        ))}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatCount(path.count)}
                      </span>
                    </li>
                  ))}
                </ol>
              )
            }
          </LiveRead>
        </Card>
      ) : null}
    </div>
  );
}

const attributionSchema = z.object({
  model: z.enum(["first_click", "last_click"]),
  type: z.enum(["path", "event"]),
  value: z.string().trim().min(1, "Enter a page path or an event name."),
});

const MODELS = [
  { value: "first_click" as const, label: "First click" },
  { value: "last_click" as const, label: "Last click" },
];
const STEP_TYPES = [
  { value: "event" as const, label: "Event" },
  { value: "path" as const, label: "Page path" },
];

type AttributionInput = z.infer<typeof attributionSchema>;

/** Which referrers, paid ads and UTM values led to a chosen page or event
 *  (Umami's attribution report). */
export function AttributionPanel({
  projectId,
  dates,
  channel,
}: AnalyticsTabProps) {
  const [input, setInput] = useState<AttributionInput | null>(null);
  const form = useAppForm({
    defaultValues: {
      model: "first_click",
      type: "event",
      value: "",
    } satisfies AttributionInput as AttributionInput,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: attributionSchema },
    onSubmit: ({ value }) => setInput(attributionSchema.parse(value)),
  });
  const query = useQuery({
    ...attributionOptions(projectId, {
      ...dates,
      channel,
      model: input?.model ?? "first_click",
      step: { type: input?.type ?? "event", value: input?.value ?? "" },
    }),
    enabled: input !== null,
  });

  return (
    <div className="space-y-4">
      <form.AppForm>
        <form.Form className="grid items-end gap-3 sm:grid-cols-[9rem_9rem_1fr_auto]">
          <form.AppField name="model">
            {(field) => <field.SelectField label="Credit" items={MODELS} />}
          </form.AppField>
          <form.AppField name="type">
            {(field) => <field.SelectField label="Goal" items={STEP_TYPES} />}
          </form.AppField>
          <form.AppField name="value">
            {(field) => (
              <field.TextField
                label="Event or path"
                placeholder="signup_completed or /thanks"
              />
            )}
          </form.AppField>
          <form.SubmitButton size="sm">Attribute</form.SubmitButton>
        </form.Form>
      </form.AppForm>
      {input ? (
        <LiveRead
          projectId={projectId}
          query={query}
          fallback="Couldn't run the attribution report in Umami."
        >
          {(result) =>
            !result.available ? (
              <p className="text-sm text-muted-foreground">{UNAVAILABLE}</p>
            ) : (
              <div className="space-y-3">
                {result.total ? (
                  <p className="text-sm text-muted-foreground">
                    {formatCount(result.total.visitors)} visitors reached the
                    goal in {formatCount(result.total.visits)} visits. Counts
                    below are visits credited to each source.
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(
                    [
                      ["Referrers", result.referrers],
                      ["Paid ads", result.paidAds],
                      ["UTM source", result.utmSources],
                      ["UTM medium", result.utmMediums],
                      ["UTM campaign", result.utmCampaigns],
                    ] as const
                  ).map(([title, rows]) => (
                    <Card key={title} className="gap-3 p-4">
                      <h3 className="text-sm font-semibold">{title}</h3>
                      <BarList
                        rows={rows.map((row) => ({
                          label: row.name,
                          value: row.visits,
                        }))}
                      />
                    </Card>
                  ))}
                </div>
              </div>
            )
          }
        </LiveRead>
      ) : null}
    </div>
  );
}
