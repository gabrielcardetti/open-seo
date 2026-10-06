import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, YAxis } from "recharts";
import { CardShell } from "@/client/components/CardShell";
import { Badge } from "@/client/components/ui/badge";
import { ChartContainer, type ChartConfig } from "@/client/components/ui/chart";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  formatVital,
  RatingBadge,
  WEB_VITAL_LABELS,
} from "@/client/features/analytics/WebVitalsTab";
import { StatGridSkeleton } from "@/client/features/dashboard/cardParts";
import { getProjectCoreWebVitals } from "@/serverFunctions/coreWebVitals";
import type { WebVital } from "@/shared/web-vitals";

const CORE_METRICS = ["lcp", "inp", "cls"] as const;
const OTHER_METRICS = ["fcp", "ttfb"] as const;

const sparklineConfig = {
  value: { label: "p75", color: "var(--color-primary)" },
} satisfies ChartConfig;

/** Google's own field data for the project's site (mobile Chrome users,
 *  28-day p75) with a weekly sparkline per Core Web Vital. Renders nothing
 *  when the deployment has no Google API key. */
export function CoreWebVitalsCard({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["dashboardCoreWebVitals", projectId],
    queryFn: () => getProjectCoreWebVitals({ data: { projectId } }),
    staleTime: 60 * 60 * 1000,
  });
  const data = query.data;
  if (data?.status === "not_configured" || data?.status === "no_domain") {
    return null;
  }

  return (
    <CardShell
      title="Core Web Vitals"
      stamp={
        data?.status === "ok" && data.collectionPeriod
          ? `Chrome UX Report · mobile · ${data.target} · to ${data.collectionPeriod.lastDate}`
          : "Chrome UX Report · mobile"
      }
      action={
        data?.status === "ok" && data.assessment ? (
          <Badge
            size="sm"
            variant={data.assessment === "passed" ? "success" : "destructive"}
          >
            {data.assessment === "passed" ? "Passed" : "Failed"}
          </Badge>
        ) : null
      }
    >
      {query.isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load Chrome UX Report data. Try again shortly.
        </p>
      ) : !data ? (
        <div className="space-y-3" aria-busy>
          <StatGridSkeleton tileClassName="h-16" />
          <Skeleton className="h-6" />
        </div>
      ) : data.status === "no_data" ? (
        <p className="text-sm text-muted-foreground">
          Google has no Chrome UX Report data for {data.tried.join(" or ")} yet.
          It publishes field data only for sites with enough Chrome traffic.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {CORE_METRICS.map((metric) => {
              const row = data.metrics.find((m) => m.metric === metric);
              return (
                <div key={metric} className="flex min-w-0 flex-col gap-1">
                  <p
                    className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    title={WEB_VITAL_LABELS[metric]}
                  >
                    {metric}
                  </p>
                  <p className="text-2xl leading-tight font-semibold tabular-nums">
                    {formatVital(metric, row?.p75 ?? null)}
                  </p>
                  <RatingBadge rating={row?.rating ?? null} />
                  <Sparkline
                    metric={metric}
                    values={(data.history ?? []).map((week) => ({
                      endDate: week.endDate,
                      value: week[metric],
                    }))}
                  />
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {OTHER_METRICS.map((metric) => {
              const row = data.metrics.find((m) => m.metric === metric);
              return `${metric.toUpperCase()} ${formatVital(metric, row?.p75 ?? null)}`;
            }).join(" · ")}{" "}
            · 75th percentile of real visits over 28 days
            {data.history?.length ? "; lines show the weekly trend" : ""}.
          </p>
        </div>
      )}
    </CardShell>
  );
}

function Sparkline({
  metric,
  values,
}: {
  metric: WebVital;
  values: Array<{ endDate: string; value: number | null }>;
}) {
  if (values.filter((v) => v.value !== null).length < 2) return null;
  return (
    <ChartContainer
      config={sparklineConfig}
      className="mt-1 h-10 w-full"
      aria-label={`${WEB_VITAL_LABELS[metric]} weekly trend`}
    >
      <LineChart
        data={values}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <YAxis hide domain={["auto", "auto"]} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={1.5}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
