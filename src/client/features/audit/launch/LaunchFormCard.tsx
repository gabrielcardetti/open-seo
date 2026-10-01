import { Link } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { Alert, AlertTitle } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import { MIN_PAGES } from "@/client/features/audit/launch/types";
import type { useLaunchController } from "@/client/features/audit/launch/useLaunchController";
import { getFieldError, getFormError } from "@/client/lib/forms";
import { PAID_MAX_AUDIT_PAGES } from "@/shared/audit-limits";
import { SUBSCRIBE_ROUTE } from "@/shared/billing";

type Props = {
  launchForm: ReturnType<typeof useLaunchController>["launchForm"];
  commitMaxPagesInput: () => number;
  maxPagesLimit: number;
};

export function LaunchFormCard({
  commitMaxPagesInput,
  launchForm,
  maxPagesLimit,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Start New Audit</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void launchForm.handleSubmit();
          }}
        >
          <launchForm.Field name="url">
            {(field) => {
              const urlError = getFieldError(field.state.meta.errors);

              return (
                <Input
                  className="lg:col-span-9"
                  aria-label="Site URL"
                  aria-invalid={urlError ? true : undefined}
                  placeholder="https://example.com"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    if (launchForm.state.errorMap.onSubmit) {
                      launchForm.setErrorMap({ onSubmit: undefined });
                    }
                  }}
                />
              );
            }}
          </launchForm.Field>

          <launchForm.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                type="submit"
                className="w-full lg:col-span-3"
                pending={isSubmitting}
              >
                {isSubmitting ? "Starting..." : "Start Audit"}
              </Button>
            )}
          </launchForm.Subscribe>

          <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-12 lg:items-start">
            <LaunchOptions
              launchForm={launchForm}
              commitMaxPagesInput={commitMaxPagesInput}
              maxPagesLimit={maxPagesLimit}
            />
            <LighthouseOptions launchForm={launchForm} />
            <ContentGuidelinesOption launchForm={launchForm} />
            <ExcludedPathsOption launchForm={launchForm} />
          </div>
        </form>

        <LaunchErrors launchForm={launchForm} />
      </CardContent>
    </Card>
  );
}

function LaunchOptions({
  launchForm,
  commitMaxPagesInput,
  maxPagesLimit,
}: Props) {
  const isFreeLimited = maxPagesLimit < PAID_MAX_AUDIT_PAGES;

  return (
    <Field className="rounded-lg border border-border p-3">
      <FieldLabel htmlFor="audit-max-pages">Max pages</FieldLabel>
      <launchForm.Field name="maxPagesInput">
        {(field) => (
          <Input
            id="audit-max-pages"
            type="number"
            min={MIN_PAGES}
            max={maxPagesLimit}
            className="w-28"
            value={field.state.value}
            onChange={(event) => {
              const next = event.target.value;
              if (!/^\d*$/.test(next)) return;
              field.handleChange(next);
              if (launchForm.state.errorMap.onSubmit) {
                launchForm.setErrorMap({ onSubmit: undefined });
              }
            }}
            onBlur={commitMaxPagesInput}
          />
        )}
      </launchForm.Field>
      <FieldDescription>
        Enter any value from {MIN_PAGES} to {maxPagesLimit.toLocaleString()}.
        {isFreeLimited ? (
          <>
            {" "}
            <Link to={SUBSCRIBE_ROUTE} search={{ upgrade: true }}>
              Upgrade
            </Link>{" "}
            to crawl up to {PAID_MAX_AUDIT_PAGES.toLocaleString()} pages.
          </>
        ) : null}
      </FieldDescription>
    </Field>
  );
}

function LighthouseOptions({ launchForm }: Pick<Props, "launchForm">) {
  return (
    <Field className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <launchForm.Field name="runLighthouse">
          {(field) => (
            <Switch
              id="audit-run-lighthouse"
              checked={Boolean(field.state.value)}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
          )}
        </launchForm.Field>
        <FieldLabel
          htmlFor="audit-run-lighthouse"
          title="Lighthouse measures the performance of your pages and identifies issues."
        >
          Include Lighthouse
        </FieldLabel>
      </div>

      <launchForm.Subscribe
        selector={(snapshot) => snapshot.values.runLighthouse}
      >
        {(runLighthouse) =>
          runLighthouse ? (
            <FieldDescription>
              We choose a sample of 20 pages to audit, removing pages from
              duplicate templates.
            </FieldDescription>
          ) : null
        }
      </launchForm.Subscribe>
    </Field>
  );
}

function LaunchErrors({ launchForm }: Pick<Props, "launchForm">) {
  return (
    <div className="space-y-2">
      <launchForm.Field name="url">
        {(field) => {
          const urlError = getFieldError(field.state.meta.errors);

          return urlError ? <FieldError>{urlError}</FieldError> : null;
        }}
      </launchForm.Field>

      <launchForm.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(submitError) => {
          const errorMessage = getFormError(submitError);

          return errorMessage ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{errorMessage}</AlertTitle>
            </Alert>
          ) : null;
        }}
      </launchForm.Subscribe>
    </div>
  );
}

function ExcludedPathsOption({ launchForm }: Pick<Props, "launchForm">) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-200/20 p-3 space-y-2">
      <label
        htmlFor="audit-excluded-paths"
        className="text-xs font-medium uppercase tracking-wide text-base-content/60"
      >
        Leave out sections
      </label>
      <launchForm.Field name="excludedPathsInput">
        {(field) => (
          <textarea
            id="audit-excluded-paths"
            rows={2}
            placeholder={"/archive\n/tag"}
            className="textarea textarea-bordered textarea-sm w-full font-mono"
            value={field.state.value}
            onChange={(event) => {
              field.handleChange(event.target.value);
              if (launchForm.state.errorMap.onSubmit) {
                launchForm.setErrorMap({ onSubmit: undefined });
              }
            }}
          />
        )}
      </launchForm.Field>
      <p className="text-xs text-base-content/50">
        One path per line. Pages under these paths are not crawled, so they use
        none of the page limit and add no findings.
      </p>
    </div>
  );
}

function ContentGuidelinesOption({ launchForm }: Pick<Props, "launchForm">) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-200/20 p-3 space-y-2">
      <label className="label cursor-pointer justify-start gap-2 p-0">
        <launchForm.Field name="evaluateContent">
          {(field) => (
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={Boolean(field.state.value)}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
          )}
        </launchForm.Field>
        <span
          className="text-sm font-medium text-base-content/80"
          title="Judges your content against Google's published content guidelines."
        >
          Evaluate content against Google&apos;s guidelines
        </span>
      </label>

      <launchForm.Subscribe
        selector={(snapshot) => snapshot.values.evaluateContent}
      >
        {(evaluateContent) =>
          evaluateContent ? (
            <p className="text-xs text-base-content/60">
              We judge a sample of your pages against Google&apos;s published
              content guidelines — people-first content, E-E-A-T, spam policies
              and AI guidance — and give each one a verdict with the evidence
              behind it. Adds a few minutes to the audit.
            </p>
          ) : null
        }
      </launchForm.Subscribe>
    </div>
  );
}
