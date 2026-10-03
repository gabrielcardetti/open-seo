import { useState } from "react";
import { revalidateLogic } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import { LiveRead, Section } from "@/client/features/analytics/AnalyticsParts";
import {
  formatPercent,
  funnelOptions,
  savedReportsOptions,
} from "@/client/features/analytics/analyticsQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

type Step = { type: "path" | "event"; value: string };
type Run =
  | { kind: "saved"; reportId: string }
  | { kind: "adhoc"; steps: Step[]; windowMinutes: number };

const STEP_TYPES = [
  { value: "path" as const, label: "Page path" },
  { value: "event" as const, label: "Event" },
];

const DEFAULT_STEPS: Step[] = [
  { type: "path", value: "/" },
  { type: "event", value: "" },
];

const builderSchema = z.object({
  steps: z
    .array(
      z.object({
        type: z.enum(["path", "event"]),
        value: z.string().trim().min(1, "Enter a path or an event name."),
      }),
    )
    .min(2)
    .max(6),
  windowMinutes: z
    .string()
    .regex(/^\d+$/, "Enter whole minutes.")
    .refine(
      (value) => Number(value) >= 1 && Number(value) <= 10_080,
      "Between 1 minute and a week (10080 minutes).",
    ),
});

/** Saved Umami funnels run for the page's range, and an ad hoc funnel of two
 *  to six page or event steps. */
export function FunnelsPanel({ projectId, dates, channel }: AnalyticsTabProps) {
  const [run, setRun] = useState<Run | null>(null);
  const savedQuery = useQuery(savedReportsOptions(projectId));

  return (
    <div className="space-y-6">
      <Section
        title="Saved funnels"
        description="Funnels saved in Umami, run for the selected dates."
      >
        <LiveRead
          projectId={projectId}
          query={savedQuery}
          fallback="Couldn't list the reports saved in Umami."
        >
          {(saved) => {
            const funnels = saved.reports.filter((report) => report.funnel);
            if (!saved.available) {
              return (
                <p className="text-sm text-muted-foreground">
                  This Umami version can&rsquo;t list saved reports.
                </p>
              );
            }
            if (funnels.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  No funnels are saved on this website in Umami. Build one
                  below.
                </p>
              );
            }
            return (
              <div className="flex flex-wrap gap-2">
                {funnels.map((report) => (
                  <Button
                    key={report.id}
                    size="sm"
                    variant={
                      run?.kind === "saved" && run.reportId === report.id
                        ? "default"
                        : "outline"
                    }
                    title={report.funnel?.steps
                      .map((step) => step.value)
                      .join(" → ")}
                    onClick={() =>
                      setRun({ kind: "saved", reportId: report.id })
                    }
                  >
                    {report.name || "Untitled funnel"}
                  </Button>
                ))}
              </div>
            );
          }}
        </LiveRead>
      </Section>

      <Section
        title="Build a funnel"
        description="Two to six steps: page paths (a * matches any text) or custom event names."
      >
        <FunnelBuilder
          onRun={(steps, windowMinutes) =>
            setRun({ kind: "adhoc", steps, windowMinutes })
          }
        />
      </Section>

      {run ? (
        <FunnelResult
          projectId={projectId}
          run={run}
          scope={{ ...dates, channel }}
        />
      ) : null}
    </div>
  );
}

function FunnelBuilder({
  onRun,
}: {
  onRun: (steps: Step[], windowMinutes: number) => void;
}) {
  const form = useAppForm({
    defaultValues: {
      steps: DEFAULT_STEPS,
      windowMinutes: "60",
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: builderSchema },
    onSubmit: ({ value }) => {
      const parsed = builderSchema.parse(value);
      onRun(parsed.steps, Number(parsed.windowMinutes));
    },
  });

  return (
    <form.AppForm>
      <form.Form className="space-y-3">
        <form.AppField name="steps" mode="array">
          {(stepsField) => (
            <div className="space-y-2">
              {stepsField.state.value.map((_, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[8rem_1fr_auto] items-start gap-2"
                >
                  <form.AppField name={`steps[${index}].type`}>
                    {(field) => (
                      <field.SelectField
                        label={`Step ${index + 1}`}
                        items={STEP_TYPES}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name={`steps[${index}].value`}>
                    {(field) => (
                      <field.TextField
                        label="Path or event"
                        placeholder="/pricing or signup_completed"
                      />
                    )}
                  </form.AppField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-6"
                    aria-label={`Remove step ${index + 1}`}
                    disabled={stepsField.state.value.length <= 2}
                    onClick={() => stepsField.removeValue(index)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={stepsField.state.value.length >= 6}
                onClick={() =>
                  stepsField.pushValue({ type: "path", value: "" })
                }
              >
                <Plus data-icon="inline-start" />
                Add step
              </Button>
            </div>
          )}
        </form.AppField>
        <div className="max-w-xs">
          <form.AppField name="windowMinutes">
            {(field) => (
              <field.TextField
                label="Window (minutes)"
                description="How long a visitor has to reach the next step."
                type="number"
                min={1}
              />
            )}
          </form.AppField>
        </div>
        <form.SubmitButton size="sm">Run funnel</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}

function FunnelResult({
  projectId,
  run,
  scope,
}: {
  projectId: string;
  run: Run;
  scope: AnalyticsTabProps["dates"] & { channel: AnalyticsTabProps["channel"] };
}) {
  const query = useQuery(
    funnelOptions(projectId, {
      ...scope,
      ...(run.kind === "saved"
        ? { reportId: run.reportId, windowMinutes: 60 }
        : { steps: run.steps, windowMinutes: run.windowMinutes }),
    }),
  );
  return (
    <Card className="gap-3 p-4">
      <LiveRead
        projectId={projectId}
        query={query}
        fallback="Couldn't run this funnel in Umami."
      >
        {(result) =>
          !result.available ? (
            <p className="text-sm text-muted-foreground">
              Funnels aren&rsquo;t available on this Umami version.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {result.savedName ? `${result.savedName} · ` : ""}
                {result.windowMinutes}-minute window between steps.
              </p>
              <ol className="space-y-2">
                {result.steps.map((step, index) => (
                  <li key={index} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="mr-2 text-muted-foreground">
                          {index + 1}.
                        </span>
                        <span className="mr-1 text-xs text-muted-foreground uppercase">
                          {step.type}
                        </span>
                        {step.value}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatCount(step.visitors)} visitors
                        {step.remainingRate !== null && index > 0 ? (
                          <span className="ml-2 text-muted-foreground">
                            {formatPercent(step.remainingRate)} of step 1
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="h-2 rounded bg-muted">
                      <div
                        className="h-2 rounded bg-primary"
                        style={{
                          width: `${(step.remainingRate ?? (index === 0 ? 1 : 0)) * 100}%`,
                        }}
                      />
                    </div>
                    {step.dropped !== null && step.dropped > 0 ? (
                      <p className="text-xs text-destructive">
                        {formatCount(step.dropped)} dropped (
                        {formatPercent(step.dropoffRate)})
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          )
        }
      </LiveRead>
    </Card>
  );
}
