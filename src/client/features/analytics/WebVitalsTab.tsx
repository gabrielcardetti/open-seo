import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/client/components/EmptyState";
import { Badge } from "@/client/components/ui/badge";
import { Card } from "@/client/components/ui/card";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import { LiveRead, Section } from "@/client/features/analytics/AnalyticsParts";
import { webVitalsOptions } from "@/client/features/analytics/analyticsQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import type { WebVital, WebVitalRating } from "@/shared/web-vitals";

type Rating = WebVitalRating | null;

export const WEB_VITAL_LABELS = {
  lcp: "Largest Contentful Paint",
  inp: "Interaction to Next Paint",
  cls: "Cumulative Layout Shift",
  fcp: "First Contentful Paint",
  ttfb: "Time to First Byte",
} as const satisfies Record<WebVital, string>;

export function formatVital(metric: WebVital, value: number | null) {
  if (value === null) return "—";
  if (metric === "cls") return value.toFixed(2);
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : `${Math.round(value)} ms`;
}

export function RatingBadge({ rating }: { rating: Rating }) {
  if (!rating) return null;
  return (
    <Badge
      size="sm"
      variant={
        rating === "good"
          ? "success"
          : rating === "poor"
            ? "destructive"
            : "warning"
      }
    >
      {rating === "good"
        ? "Good"
        : rating === "poor"
          ? "Poor"
          : "Needs improvement"}
    </Badge>
  );
}

/** Web Vitals percentiles from Umami's performance report. */
export function WebVitalsTab({ projectId, dates, channel }: AnalyticsTabProps) {
  const query = useQuery(webVitalsOptions(projectId, { ...dates, channel }));
  return (
    <LiveRead
      projectId={projectId}
      query={query}
      fallback="Couldn't load Web Vitals from Umami."
    >
      {(result) =>
        !result.available ? (
          <EmptyState
            title="Web Vitals aren't available on this Umami version"
            description="Umami reports Web Vitals from version 3.2. Upgrade the instance to see them here."
          />
        ) : !result.hasData ? (
          <EmptyState
            title="No Web Vitals data"
            description={
              <>
                Umami records Web Vitals only when its tracking script has
                performance tracking on. Add{" "}
                <code>data-performance=&quot;true&quot;</code> to the Umami{" "}
                <code>&lt;script&gt;</code> tag on your site; real visits then
                fill this tab.
              </>
            }
          />
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              {formatCount(result.sampleCount)} measurements from real visits.
              Ratings use the 75th percentile and Google&rsquo;s Core Web Vitals
              thresholds.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {result.metrics.map((metric) => (
                <Card key={metric.metric} className="gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {metric.metric}
                    </p>
                    <RatingBadge rating={metric.rating} />
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatVital(metric.metric, metric.p75)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {WEB_VITAL_LABELS[metric.metric]} · p50{" "}
                    {formatVital(metric.metric, metric.p50)} · p95{" "}
                    {formatVital(metric.metric, metric.p95)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Good ≤ {formatVital(metric.metric, metric.thresholds[0])},
                    poor &gt; {formatVital(metric.metric, metric.thresholds[1])}
                  </p>
                </Card>
              ))}
            </div>
            {(
              [
                ["Largest Contentful Paint by page", "Page", result.pages],
                ["By device", "Device", result.devices],
                ["By browser", "Browser", result.browsers],
              ] as const
            ).map(([title, column, rows]) =>
              rows.length === 0 ? null : (
                <Section key={title} title={title}>
                  <TableCard>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{column}</TableHead>
                          <TableHead className="text-right">p50</TableHead>
                          <TableHead className="text-right">p75</TableHead>
                          <TableHead className="text-right">p95</TableHead>
                          <TableHead className="text-right">Samples</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={row.name}>
                            <TableCell className="max-w-md truncate">
                              {row.name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatVital("lcp", row.p50)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatVital("lcp", row.p75)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatVital("lcp", row.p95)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCount(row.count)}
                            </TableCell>
                            <TableCell>
                              <RatingBadge rating={row.rating} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableCard>
                </Section>
              ),
            )}
          </div>
        )
      }
    </LiveRead>
  );
}
