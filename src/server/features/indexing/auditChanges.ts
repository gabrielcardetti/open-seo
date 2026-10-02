/**
 * After a site audit completes, announce the pages that are new or whose
 * content changed since the project's previous completed audit of the same
 * origin.
 *
 * This runs inside the audit worker, which deliberately gets no
 * BETTER_AUTH_SECRET and so cannot open a Bing API key. It therefore uses
 * IndexNow only, and only once the key is verified; projects that rely on
 * Bing's API get their new pages through the daily sitemap check instead.
 */
import { AuditComparisonRepository } from "@/server/features/audit/repositories/AuditComparisonRepository";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { IndexingRepository } from "./IndexingRepository";
import { UrlSubmissionService } from "./UrlSubmissionService";

const PREVIOUS_AUDITS_SCANNED = 10;

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export async function submitAuditChanges(input: {
  projectId: string;
  auditId: string;
}): Promise<{ submitted: number; skipped: string | null }> {
  const settings = await IndexingRepository.getSettings(input.projectId);
  if (!settings?.autoSubmitEnabled) {
    return { submitted: 0, skipped: "auto_submit_off" };
  }
  if (!settings.indexnowKey || !settings.indexnowVerifiedAt) {
    return { submitted: 0, skipped: "no_verified_indexnow_key" };
  }
  const audit = await AuditRepository.getAuditForProject(
    input.auditId,
    input.projectId,
  );
  if (!audit) return { submitted: 0, skipped: "audit_not_found" };

  const origin = originOf(audit.startUrl);
  const previous = (
    await AuditComparisonRepository.getPreviousCompletedAudits(
      input.projectId,
      audit,
      PREVIOUS_AUDITS_SCANNED,
    )
  ).find((candidate) => originOf(candidate.startUrl) === origin);
  // The first audit of a site is the baseline: nothing to compare with.
  if (!previous) return { submitted: 0, skipped: "no_previous_audit" };

  const [before, after] = await Promise.all([
    AuditComparisonRepository.getPageHashesForAudit(previous.id),
    AuditComparisonRepository.getPageHashesForAudit(audit.id),
  ]);
  const hashBefore = new Map(
    before.map((page) => [page.url, page.contentHash]),
  );
  const urls = after
    .filter((page) => {
      if (page.statusCode !== 200 || !page.isIndexable) return false;
      if (!hashBefore.has(page.url)) return true;
      const previousHash = hashBefore.get(page.url);
      return Boolean(
        previousHash && page.contentHash && previousHash !== page.contentHash,
      );
    })
    .map((page) => page.url);
  if (urls.length === 0) return { submitted: 0, skipped: null };

  const result = await UrlSubmissionService.submitUrls(
    input.projectId,
    urls,
    "audit",
    { channel: "indexnow" },
  );
  return {
    submitted: result.results.length,
    skipped: result.problem,
  };
}
