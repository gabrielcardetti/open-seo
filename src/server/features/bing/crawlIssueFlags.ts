// Bing's CrawlIssues flags (Microsoft.Bing.Webmaster.Api.Interfaces). Labels
// are best-effort until checked against live answers; the raw value is kept.
export const CRAWL_ISSUE_FLAG = {
  redirect301: 1,
  redirect302: 2,
  code4xx: 4,
  code5xx: 8,
  blockedByRobotsTxt: 16,
  containsMalware: 32,
  importantUrlBlockedByRobotsTxt: 64,
  dnsError: 128,
  timeout: 256,
} as const;

const CRAWL_ISSUE_LABELS: Array<[number, string]> = [
  [CRAWL_ISSUE_FLAG.redirect301, "301 redirect"],
  [CRAWL_ISSUE_FLAG.redirect302, "302 redirect"],
  [CRAWL_ISSUE_FLAG.code4xx, "4xx error"],
  [CRAWL_ISSUE_FLAG.code5xx, "5xx error"],
  [CRAWL_ISSUE_FLAG.blockedByRobotsTxt, "Blocked by robots.txt"],
  [CRAWL_ISSUE_FLAG.containsMalware, "Contains malware"],
  [
    CRAWL_ISSUE_FLAG.importantUrlBlockedByRobotsTxt,
    "Important URL blocked by robots.txt",
  ],
  [CRAWL_ISSUE_FLAG.dnsError, "DNS error"],
  [CRAWL_ISSUE_FLAG.timeout, "Timeout"],
];

/** Plain-language labels for a crawl issue's flags. */
export function crawlIssueLabels(flags: number): string[] {
  const labels = CRAWL_ISSUE_LABELS.filter(([bit]) => (flags & bit) !== 0).map(
    ([, label]) => label,
  );
  const known = CRAWL_ISSUE_LABELS.reduce((all, [bit]) => all | bit, 0);
  if ((flags & ~known) !== 0) labels.push(`Other (flags ${flags})`);
  return labels;
}
