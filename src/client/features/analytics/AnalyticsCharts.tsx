import { Line, LineChart } from "recharts";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { GoogleUpdateMarkers } from "@/client/components/GoogleUpdateMarkers";
import { formatBingTick } from "@/client/features/bing/bingQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact" });

function formatAxis(value: unknown): string {
  return typeof value === "number" ? compactFormat.format(value) : "";
}

// Distinct hues for up to ten series (events, assistants).
const PALETTE = [
  "#2563eb",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#0ea5e9",
  "#84cc16",
  "#ec4899",
  "#64748b",
  "#a16207",
];

/**
 * A daily line chart, one line per series. `series` maps each data key to its
 * label; keys must be safe CSS identifiers (they name color variables).
 */
export function DailyChart({
  data,
  series,
  label,
  className = "h-56",
}: {
  data: Array<Record<string, unknown>>;
  series: Array<{ key: string; label: string }>;
  label: string;
  className?: string;
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((item, index) => [
      item.key,
      { label: item.label, color: PALETTE[index % PALETTE.length] },
    ]),
  );
  return (
    <ChartContainer config={config} className={className} aria-label={label}>
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <ChartGrid />
        <ChartXAxis dataKey="date" tickFormatter={formatBingTick} />
        <ChartYAxis tickFormatter={formatAxis} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value: unknown) => formatBingTick(value)}
              valueFormatter={(value) => formatCount(Number(value))}
            />
          }
        />
        <GoogleUpdateMarkers
          dates={data.flatMap((point) =>
            typeof point.date === "string" ? [point.date] : [],
          )}
        />
        {series.length > 1 ? (
          <ChartLegend content={<ChartLegendContent />} />
        ) : null}
        {series.map((item) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            stroke={`var(--color-${item.key})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
