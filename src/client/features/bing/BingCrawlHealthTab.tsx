import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { StatTile } from "@/client/components/StatTile";
import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { BingCrawlChart } from "@/client/features/bing/BingCharts";
import {
  bingCrawlHealthOptions,
  bingErrorMessage,
  formatBingDay,
  type BingDates,
} from "@/client/features/bing/bingQueries";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatCount(value);
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function IssueLabels({ labels }: { labels: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="outline" size="sm">
          {label}
        </Badge>
      ))}
    </span>
  );
}

function UrlCell({ url }: { url: string }) {
  return (
    <TableCell className="max-w-md">
      <span className="block truncate" title={url}>
        {url}
      </span>
    </TableCell>
  );
}

/** Bingbot's crawl of the site: the daily series, the URLs it has problems
 *  with now, the ones that recovered, and the sitemaps it reads. */
export function BingCrawlHealthTab({
  projectId,
  dates,
}: {
  projectId: string;
  dates: BingDates;
}) {
  const crawlQuery = useQuery(bingCrawlHealthOptions(projectId, dates));

  if (crawlQuery.isPending) {
    return <SkeletonTableRows className="p-4" />;
  }
  if (crawlQuery.isError) {
    return (
      <div className="p-4">
        <QueryError
          cause={crawlQuery.error}
          fallback={bingErrorMessage(
            crawlQuery.error,
            "Couldn't load Bing crawl data.",
          )}
          onRetry={() => void crawlQuery.refetch()}
          isRetrying={crawlQuery.isFetching}
        />
      </div>
    );
  }
  const health = crawlQuery.data;
  if (!health.connected) return null;
  const latest = health.daily.at(-1);

  return (
    <div className="space-y-6 p-4">
      <Section
        title="Bingbot crawl"
        hint={
          latest
            ? `Latest day: ${formatBingDay(latest.date)}`
            : "No crawl data stored for these dates yet."
        }
      >
        {latest ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile label="Crawled" value={count(latest.crawledPages)} />
              <StatTile label="In index" value={count(latest.inIndex)} />
              <StatTile
                label="Crawl errors"
                value={count(latest.crawlErrors)}
                tone={latest.crawlErrors ? "destructive" : undefined}
              />
              <StatTile
                label="Blocked by robots.txt"
                value={count(latest.blockedByRobotsTxt)}
              />
            </div>
            <BingCrawlChart data={health.daily} />
          </>
        ) : null}
      </Section>

      <Section
        title={`Open issues (${formatCount(health.openIssues.totalCount)})`}
        hint={
          health.openIssues.totalCount > health.openIssues.rows.length
            ? `Showing the ${health.openIssues.rows.length} most recently seen.`
            : "URLs Bing reported a problem with on its last check. They also show up in site audits."
        }
      >
        {health.openIssues.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Bing reports no crawl issues right now.
          </p>
        ) : (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">HTTP</TableHead>
                  <TableHead className="text-right">Links in</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.openIssues.rows.map((issue) => (
                  <TableRow key={issue.url}>
                    <UrlCell url={issue.url} />
                    <TableCell>
                      <IssueLabels labels={issue.labels} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {issue.httpCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(issue.inLinks)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBingDay(issue.firstSeenAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBingDay(issue.lastSeenAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </Section>

      {health.resolvedIssues.length > 0 ? (
        <Section
          title="Recently resolved"
          hint="Issues Bing stopped reporting since the start of these dates."
        >
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Resolved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.resolvedIssues.map((issue) => (
                  <TableRow key={issue.url}>
                    <UrlCell url={issue.url} />
                    <TableCell>
                      <IssueLabels labels={issue.labels} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {issue.resolvedAt ? formatBingDay(issue.resolvedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      <Section title="Sitemaps" hint="The sitemaps and feeds Bing knows about.">
        {health.sitemaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Bing has no sitemaps for this site. Submit yours in Bing Webmaster
            Tools → Sitemaps so Bing finds new pages sooner.
          </p>
        ) : (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sitemap</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">URLs</TableHead>
                  <TableHead>Last crawled</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.sitemaps.map((sitemap) => (
                  <TableRow key={sitemap.feedUrl}>
                    <UrlCell url={sitemap.feedUrl} />
                    <TableCell>{sitemap.status ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(sitemap.urlCount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sitemap.lastCrawledAt
                        ? formatBingDay(sitemap.lastCrawledAt)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sitemap.submittedAt
                        ? formatBingDay(sitemap.submittedAt)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </Section>
    </div>
  );
}
