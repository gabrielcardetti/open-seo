import { openBingClientForProject } from "@/server/features/bing/bingAccess";
import {
  resolveRange,
  type DateRangeInput,
} from "@/server/features/bing/bingStats";
import { crawlIssueLabels } from "@/server/features/bing/crawlIssueFlags";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { BingSnapshotRepository } from "@/server/features/bing/repositories/BingSnapshotRepository";

const DEFAULT_CRAWL_RANGE_DAYS = 90;
const OPEN_ISSUE_LIMIT = 200;
const RESOLVED_ISSUE_LIMIT = 50;

/**
 * Bingbot's crawl of the site from the stored history: the daily series for
 * the range, the newest day, the URLs Bing currently reports problems for,
 * the issues that stopped being reported since the range began, and the
 * sitemaps Bing knows (flagging the ones it no longer reports).
 */
async function crawlHealth(projectId: string, input: DateRangeInput = {}) {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection) return { connected: false as const };
  const scope = { projectId, siteUrl: connection.siteUrl };
  const range = resolveRange(
    input,
    await BingSnapshotRepository.getLatestCrawlDate(scope),
    DEFAULT_CRAWL_RANGE_DAYS,
  );
  const [daily, openIssues, resolvedIssues, sitemaps] = await Promise.all([
    BingSnapshotRepository.getCrawlDays(scope, range.startDate, range.endDate),
    BingSnapshotRepository.getOpenCrawlIssues(scope, OPEN_ISSUE_LIMIT),
    BingSnapshotRepository.getResolvedCrawlIssues(
      scope,
      range.startDate,
      RESOLVED_ISSUE_LIMIT,
    ),
    BingSnapshotRepository.getSitemaps(scope),
  ]);
  // Every sitemap in a successful GetFeeds answer gets that sync's time, so
  // one seen before the newest answer was missing from it: Bing stopped
  // reporting it. Rows stay as history. (When Bing stops reporting every
  // sitemap at once there's no newer answer to compare with, so none is
  // flagged.)
  const latestSitemapAnswer = sitemaps.reduce(
    (latest, sitemap) =>
      sitemap.lastSeenAt > latest ? sitemap.lastSeenAt : latest,
    "",
  );
  const withLabels = <T extends { issueFlags: number }>(issue: T) => ({
    ...issue,
    labels: crawlIssueLabels(issue.issueFlags),
  });
  return {
    connected: true as const,
    siteUrl: scope.siteUrl,
    range,
    daily: daily.map(
      ({ projectId: _p, siteUrl: _s, updatedAt: _u, ...day }) => day,
    ),
    latest: daily.at(-1)?.date ?? null,
    openIssues: {
      totalCount: openIssues.totalCount,
      rows: openIssues.rows.map(withLabels),
    },
    resolvedIssues: resolvedIssues.map(withLabels),
    sitemaps: sitemaps.map((sitemap) => ({
      ...sitemap,
      noLongerReported: sitemap.lastSeenAt < latestSitemapAnswer,
    })),
  };
}

/**
 * Without `url`: the newest weekly link-count snapshot, pages ranked by
 * inbound links (stored history). With `url`: the pages linking to it, live
 * from Bing (GetUrlLinks). `page` is 1-based.
 */
async function backlinks(
  projectId: string,
  input: { url?: string; page: number; pageSize: number },
) {
  if (input.url) {
    const { connection, client } = await openBingClientForProject(projectId);
    const result = await client.getUrlLinks(
      connection.siteUrl,
      input.url,
      input.page - 1,
    );
    return {
      connected: true as const,
      mode: "links" as const,
      siteUrl: connection.siteUrl,
      url: input.url,
      page: input.page,
      totalPages: result.totalPages,
      rows: result.links,
    };
  }
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection) return { connected: false as const };
  const scope = { projectId, siteUrl: connection.siteUrl };
  const capturedOn =
    await BingSnapshotRepository.getLatestLinkCaptureDate(scope);
  const { rows, totalCount } = capturedOn
    ? await BingSnapshotRepository.getLinkCounts(
        scope,
        capturedOn,
        input.pageSize,
        (input.page - 1) * input.pageSize,
      )
    : { rows: [], totalCount: 0 };
  return {
    connected: true as const,
    mode: "pages" as const,
    siteUrl: scope.siteUrl,
    capturedOn,
    page: input.page,
    pageSize: input.pageSize,
    totalCount,
    rows,
  };
}

export const BingSiteHealthService = {
  crawlHealth,
  backlinks,
};
