import { useQuery } from "@tanstack/react-query";
import { SkeletonStatGrid } from "@/client/components/SkeletonPresets";
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
import { DailyChart } from "@/client/features/analytics/AnalyticsCharts";
import type { AnalyticsTabProps } from "@/client/features/analytics/AnalyticsPage";
import {
  BarList,
  LiveRead,
  MetricCard,
  Section,
} from "@/client/features/analytics/AnalyticsParts";
import {
  aiReferralsOptions,
  formatDuration,
  formatPercent,
  overviewOptions,
  searchEnginesOptions,
} from "@/client/features/analytics/analyticsQueries";
import { OrganicLandingsTable } from "@/client/features/analytics/OrganicLandingsTable";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

const ENGINE_LABELS: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  yandex: "Yandex",
  other: "Others (Baidu, Brave, MSN)",
};

const ASSISTANT_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  copilot: "Copilot",
  gemini: "Gemini",
  claude: "Claude",
  deepseek: "DeepSeek",
  grok: "Grok",
  meta_ai: "Meta AI",
  mistral: "Mistral",
  other: "Other assistants",
};

/** Organic search and AI assistant traffic, and the organic landing pages
 *  next to Search Console and Bing. */
export function SeoTab(props: AnalyticsTabProps) {
  const { projectId, dates } = props;
  const organicQuery = useQuery(
    overviewOptions(projectId, { ...dates, channel: "organic_search" }),
  );
  const enginesQuery = useQuery(searchEnginesOptions(projectId, dates));

  return (
    <div className="space-y-6">
      <Section
        title="Organic search"
        description="Visits referred by a search engine's own host. Paid clicks with a search referrer count too."
      >
        <LiveRead
          projectId={projectId}
          query={organicQuery}
          fallback="Couldn't load organic traffic."
          skeleton={<SkeletonStatGrid />}
        >
          {(organic) => (
            <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
              <Card className="p-4">
                <DailyChart
                  data={organic.trend}
                  label="Organic visitors per day"
                  series={[{ key: "visitors", label: "Organic visitors" }]}
                />
              </Card>
              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  label="Visits"
                  value={formatCount(organic.current.visits)}
                  delta={{
                    current: organic.current.visits,
                    previous: organic.previous.visits,
                  }}
                />
                <MetricCard
                  label="Visitors"
                  value={formatCount(organic.current.visitors)}
                  delta={{
                    current: organic.current.visitors,
                    previous: organic.previous.visitors,
                  }}
                />
                <MetricCard
                  label="Bounce rate"
                  value={formatPercent(organic.current.bounceRate)}
                />
                <MetricCard
                  label="Avg. visit"
                  value={formatDuration(organic.current.avgVisitSeconds)}
                />
              </div>
            </div>
          )}
        </LiveRead>
        <LiveRead
          projectId={projectId}
          query={enginesQuery}
          fallback="Couldn't load visits by search engine."
        >
          {(result) =>
            result.engines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No search engine referred a visit in this period.
              </p>
            ) : (
              <TableCard>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Search engine</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Before</TableHead>
                      <TableHead className="text-right">Visitors</TableHead>
                      <TableHead className="text-right">Bounce</TableHead>
                      <TableHead className="text-right">Avg. visit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.engines.map((row) => (
                      <TableRow key={row.engine}>
                        <TableCell>
                          <span className="font-medium">
                            {ENGINE_LABELS[row.engine] ?? row.engine}
                          </span>
                          {row.domains.length > 0 ? (
                            <span
                              className="ml-2 text-xs text-muted-foreground"
                              title={row.domains.join(", ")}
                            >
                              {row.domains.slice(0, 3).join(", ")}
                              {row.domains.length > 3 ? ", …" : ""}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(row.visits)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatCount(row.previousVisits)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(row.visitors)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercent(row.bounceRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(row.avgVisitSeconds)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
            )
          }
        </LiveRead>
      </Section>

      <AiAssistants projectId={projectId} dates={dates} />

      <Section
        title="Organic landing pages"
        description="Where search visits entered, with the same pages' Search Console and Bing numbers, matched by path."
      >
        <OrganicLandingsTable {...props} />
      </Section>
    </div>
  );
}

function AiAssistants({
  projectId,
  dates,
}: Pick<AnalyticsTabProps, "projectId" | "dates">) {
  const query = useQuery(aiReferralsOptions(projectId, dates));
  return (
    <Section
      title="AI assistants"
      description="Visits from ChatGPT, Perplexity, Copilot, Gemini, Claude and others: by referrer host, and by the utm_source on the link (ChatGPT adds utm_source=chatgpt.com). A visit carrying both counts in both columns."
    >
      <LiveRead
        projectId={projectId}
        query={query}
        fallback="Couldn't load AI assistant traffic."
      >
        {(result) =>
          result.assistants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No visits from AI assistants recorded in this period.
              {result.utmReportAvailable
                ? ""
                : " This Umami can't run its UTM report, so only referrer hosts were checked."}
            </p>
          ) : (
            <div className="space-y-3">
              <TableCard>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Assistant</TableHead>
                      <TableHead className="text-right">
                        Referred visits
                      </TableHead>
                      <TableHead className="text-right">Bounce</TableHead>
                      <TableHead className="text-right">
                        Tagged views (utm_source)
                      </TableHead>
                      <TableHead>Seen as</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.assistants.map((row) => (
                      <TableRow key={row.assistant}>
                        <TableCell className="font-medium">
                          {ASSISTANT_LABELS[row.assistant] ?? row.assistant}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(row.referredVisits)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercent(row.referredBounceRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(row.taggedViews)}
                        </TableCell>
                        <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                          {[...row.hosts, ...row.utmSources].join(", ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
              <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
                <Card className="p-4">
                  <DailyChart
                    data={result.trend}
                    label="AI assistant visitors per day"
                    series={[
                      { key: "referred", label: "Referred" },
                      { key: "tagged", label: "Tagged (utm_source)" },
                    ]}
                  />
                </Card>
                <Card className="gap-3 p-4">
                  <h3 className="text-sm font-semibold">Landing pages</h3>
                  <BarList
                    rows={result.landingPages.map((row) => ({
                      label: row.path,
                      value: row.referred + row.tagged,
                    }))}
                  />
                </Card>
              </div>
            </div>
          )
        }
      </LiveRead>
    </Section>
  );
}
