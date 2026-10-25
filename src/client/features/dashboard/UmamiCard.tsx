import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { CardShell } from "@/client/components/CardShell";
import { GoogleUpdateMarkers } from "@/client/components/GoogleUpdateMarkers";
import { MetricsTable, percentChange } from "@/client/components/MetricsTable";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { moreDetailsClass } from "@/client/features/dashboard/cardParts";
import {
  formatCount,
  formatCtr,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { getUmamiDashboardReport } from "@/serverFunctions/umami";

const visitorsChartConfig = {
  visitors: { label: "Visitors", color: "var(--color-primary)" },
} satisfies ChartConfig;

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function formatTrendDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A period-over-period change for MetricsTable; undefined renders "—". */
function changeCell(change: number | null) {
  if (change === null) return undefined;
  return (
    <span
      className={
        change > 0
          ? "text-success"
          : change < 0
            ? "text-destructive"
            : "text-muted-foreground"
      }
    >
      {change > 0 ? "+" : ""}
      {change}%
    </span>
  );
}

/** Organic search visitors from the project's Umami website, shown on the
 *  dashboard when Google Analytics isn't connected. */
export function UmamiCard({ projectId }: { projectId: string }) {
  const reportQuery = useQuery({
    queryKey: ["dashboardUmamiReport", projectId],
    queryFn: () => getUmamiDashboardReport({ data: { projectId } }),
  });
  const report = reportQuery.data;

  return (
    <CardShell
      title="Organic traffic"
      action={
        <Link
          to="/p/$projectId/settings/integrations"
          params={{ projectId }}
          hash="umami"
          className={moreDetailsClass}
        >
          Manage
        </Link>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Umami · Search engine visits · Last 28 days
      </p>
      {reportQuery.isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load Umami data. Try again shortly.
        </p>
      ) : !report ? (
        <div className="space-y-3" aria-busy>
          <SkeletonTableRows rows={4} columns={3} />
          <Skeleton className="h-24" />
        </div>
      ) : !report.connected ? (
        <p className="text-sm text-muted-foreground">
          Umami refused to share this project&rsquo;s data. Check the connection
          on the Integrations page.
        </p>
      ) : !report.totals.visits ? (
        <p className="text-sm text-muted-foreground">
          No visits from search engines recorded in the last 28 days yet.
        </p>
      ) : (
        <div className="space-y-4">
          <MetricsTable
            showChange
            rows={[
              {
                label: "Visitors",
                value: formatCount(report.totals.visitors),
                change: changeCell(
                  percentChange(
                    report.totals.visitors,
                    report.prevTotals.visitors,
                  ),
                ),
              },
              {
                label: "Visits",
                value: formatCount(report.totals.visits),
                change: changeCell(
                  percentChange(report.totals.visits, report.prevTotals.visits),
                ),
              },
              {
                label: "Bounce rate",
                value:
                  report.totals.bounceRate === null
                    ? "—"
                    : formatCtr(report.totals.bounceRate),
              },
              {
                label: "Avg. visit",
                value: formatDuration(report.totals.avgVisitSeconds),
              },
            ]}
          />
          <ChartContainer config={visitorsChartConfig} className="h-24">
            <AreaChart
              data={report.trend}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            >
              <XAxis dataKey="date" hide />
              <YAxis hide domain={[0, "auto"]} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label: unknown) =>
                      typeof label === "string" ? formatTrendDay(label) : ""
                    }
                    valueFormatter={(value) => formatCount(Number(value))}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="visitors"
                stroke="var(--color-visitors)"
                strokeWidth={2}
                fill="var(--color-visitors)"
                fillOpacity={0.08}
              />
              <GoogleUpdateMarkers
                dates={report.trend.map((point) => point.date)}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      )}
    </CardShell>
  );
}
