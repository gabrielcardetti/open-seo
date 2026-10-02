import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import {
  CRAWL_ISSUE_FLAG,
  crawlIssueLabels,
} from "@/server/features/bing/crawlIssueFlags";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { BingSnapshotRepository } from "@/server/features/bing/repositories/BingSnapshotRepository";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";
import { normalizeUrl } from "@/server/lib/audit/url-utils";
import type { AuditIssueType } from "@/shared/audit-issues";

// Bing reports one row per URL; an audit lists at most this many of them.
const MAX_BING_CRAWL_ISSUES = 500;

const CRAWL_ERROR_FLAGS =
  CRAWL_ISSUE_FLAG.code4xx |
  CRAWL_ISSUE_FLAG.code5xx |
  CRAWL_ISSUE_FLAG.dnsError |
  CRAWL_ISSUE_FLAG.timeout;
const ROBOTS_FLAGS =
  CRAWL_ISSUE_FLAG.blockedByRobotsTxt |
  CRAWL_ISSUE_FLAG.importantUrlBlockedByRobotsTxt;

function issueTypesFor(row: {
  httpCode: number | null;
  issueFlags: number;
}): AuditIssueType[] {
  const types: AuditIssueType[] = [];
  if (row.issueFlags & CRAWL_ISSUE_FLAG.containsMalware) {
    types.push("bing-malware");
  }
  if (
    row.issueFlags & CRAWL_ERROR_FLAGS ||
    (row.httpCode !== null && row.httpCode >= 400)
  ) {
    types.push("bing-crawl-error");
  }
  if (row.issueFlags & ROBOTS_FLAGS) types.push("bing-blocked-by-robots");
  return types;
}

/**
 * The crawl problems Bing currently reports for the project's connected site,
 * as audit issues. Reads the snapshot tables the Bing sync fills — the audit
 * never calls Bing — and returns nothing when the project has no Bing
 * connection. Issues point at the audit's page row when our crawl reached the
 * same URL. Redirect-only rows aren't problems and are left out.
 */
export async function collectBingAuditIssues(input: {
  projectId: string;
  auditId: string;
}): Promise<DetectedIssue[]> {
  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) return [];
  const { rows } = await BingSnapshotRepository.getOpenCrawlIssues(
    { projectId: input.projectId, siteUrl: connection.siteUrl },
    MAX_BING_CRAWL_ISSUES,
  );
  if (rows.length === 0) return [];

  const pages = await AuditRepository.getPagesForAudit(input.auditId);
  const pageIdByUrl = new Map(pages.map((page) => [page.url, page.id]));
  return rows.flatMap((row) => {
    const url = normalizeUrl(row.url) ?? row.url;
    return issueTypesFor(row).map((issueType) => ({
      issueType,
      pageId: pageIdByUrl.get(url) ?? null,
      pageUrl: url,
      details: {
        bingReports: crawlIssueLabels(row.issueFlags).join(", "),
        httpStatus: row.httpCode,
        lastSeen: row.lastSeenAt.slice(0, 10),
      },
    }));
  });
}
