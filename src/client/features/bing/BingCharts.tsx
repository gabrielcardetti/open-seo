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
import { formatBingTick } from "@/client/features/bing/bingQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact" });

function formatAxis(value: unknown): string {
  return typeof value === "number" ? compactFormat.format(value) : "";
}

const tooltip = (
  <ChartTooltip
    content={
      <ChartTooltipContent
        labelFormatter={(label: unknown) => formatBingTick(label)}
        valueFormatter={(value) => formatCount(Number(value))}
      />
    }
  />
);
const legend = <ChartLegend content={<ChartLegendContent />} />;

type SeriesLine = { key: string; axis?: "left" | "right" };

/** A daily line chart. Series on the right axis have their own scale, for
 *  counts far smaller than the left-axis ones. */
function DailyLineChart({
  data,
  config,
  lines,
  label,
}: {
  data: Array<Record<string, unknown>>;
  config: ChartConfig;
  lines: SeriesLine[];
  label: string;
}) {
  const hasRightAxis = lines.some((line) => line.axis === "right");
  return (
    <ChartContainer config={config} className="h-56" aria-label={label}>
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <ChartGrid />
        <ChartXAxis dataKey="date" tickFormatter={formatBingTick} />
        <ChartYAxis yAxisId="left" tickFormatter={formatAxis} />
        {hasRightAxis ? (
          <ChartYAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={formatAxis}
          />
        ) : null}
        {tooltip}
        {legend}
        {lines.map((line) => (
          <Line
            key={line.key}
            yAxisId={line.axis ?? "left"}
            type="monotone"
            dataKey={line.key}
            stroke={`var(--color-${line.key})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

const trafficConfig = {
  clicks: { label: "Clicks", color: "#2563eb" },
  impressions: { label: "Impressions", color: "#8b5cf6" },
} satisfies ChartConfig;

export function BingTrafficChart({
  data,
}: {
  data: Array<{ date: string; clicks: number; impressions: number }>;
}) {
  return (
    <DailyLineChart
      data={data}
      config={trafficConfig}
      label="Bing clicks and impressions per day"
      lines={[{ key: "clicks" }, { key: "impressions", axis: "right" }]}
    />
  );
}

const crawlConfig = {
  crawledPages: { label: "Crawled", color: "#2563eb" },
  inIndex: { label: "In index", color: "#14b8a6" },
  crawlErrors: { label: "Crawl errors", color: "#ef4444" },
  code4xx: { label: "4xx", color: "#f59e0b" },
  code5xx: { label: "5xx", color: "#b91c1c" },
} satisfies ChartConfig;

export function BingCrawlChart({
  data,
}: {
  data: Array<{
    date: string;
    crawledPages: number | null;
    inIndex: number | null;
    crawlErrors: number | null;
    code4xx: number | null;
    code5xx: number | null;
  }>;
}) {
  return (
    <DailyLineChart
      data={data}
      config={crawlConfig}
      label="Bingbot crawl per day"
      lines={[
        { key: "crawledPages" },
        { key: "inIndex" },
        { key: "crawlErrors", axis: "right" },
        { key: "code4xx", axis: "right" },
        { key: "code5xx", axis: "right" },
      ]}
    />
  );
}

const citationsConfig = {
  citations: { label: "Citations", color: "#2563eb" },
  citedPages: { label: "Cited pages", color: "#14b8a6" },
} satisfies ChartConfig;

export function BingCitationsChart({
  data,
}: {
  data: Array<{ date: string; citations: number; citedPages: number | null }>;
}) {
  return (
    <DailyLineChart
      data={data}
      config={citationsConfig}
      label="AI citations per day"
      lines={[{ key: "citations" }, { key: "citedPages", axis: "right" }]}
    />
  );
}
