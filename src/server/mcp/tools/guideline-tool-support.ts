/**
 * Shared plumbing for the guideline MCP tools.
 */
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GuidelineEvaluationRepository } from "@/server/features/audit/repositories/GuidelineEvaluationRepository";
import { parseAuditConfig } from "@/server/lib/audit/types";
import { AppError } from "@/server/lib/errors";
import type { RuleJudge } from "@/server/lib/guidelines/judge";
import type {
  PageEvaluation,
  SubmittedFinding,
} from "@/server/lib/guidelines/page-evaluator";
import type { SitePageResult } from "@/server/lib/guidelines/site-evaluator";
import type { SiteFacts } from "@/server/lib/guidelines/site-facts";
import {
  CATALOG_VERSION,
  rulesForContext,
  type GuidelineRule,
} from "@/shared/guidelines/catalog";
import { SITE_PATTERN_RULES } from "@/shared/guidelines/judge-map";

export const auditIdSchema = z
  .string()
  .optional()
  .describe("Audit ID. If omitted, uses the project's most recent audit.");

export function auditPath(projectId: string, auditId: string) {
  return `/p/${projectId}/audit?auditId=${auditId}&tab=guidelines`;
}

export async function resolveAudit(projectId: string, auditId?: string) {
  const audit = auditId
    ? await AuditRepository.getAuditForProject(auditId, projectId)
    : await AuditRepository.getLatestAuditForProject(projectId);
  if (!audit) {
    throw new AppError(
      "NOT_FOUND",
      auditId
        ? `Audit ${auditId} not found in this project.`
        : "No audits exist for this project yet. Start one with run_site_audit.",
    );
  }
  return audit;
}

// ─── The whole-site item ────────────────────────────────────────────────────

/** A site finding as an external judge submits it: a page finding plus the clusters it cites. */
export interface SubmittedSiteFinding extends SubmittedFinding {
  clusters?: string[];
}

/** The stored audit fields the site inputs are read from. */
interface StoredAudit {
  id: string;
  startUrl: string;
  status: string;
  config: string;
  pagesCrawled: number;
}

/**
 * Whether the stored crawl reached the end of its frontier. The workflow knows
 * this directly; from the database it is "finished, short of its page limit,
 * and not cut off by rate limiting". Anything unclear counts as truncated,
 * which only makes the trust-page answers less strict.
 */
async function storedCrawlCompleted(audit: StoredAudit): Promise<boolean> {
  const maxPages = parseAuditConfig(audit.config)?.maxPages;
  if (audit.status !== "completed" || !maxPages) return false;
  if (audit.pagesCrawled >= maxPages) return false;
  const rateLimited = await AuditRepository.getIssuesForAudit(audit.id, {
    issueType: "crawl-rate-limited",
  });
  return rateLimited.length === 0;
}

/**
 * What the MCP tools build the site from, re-read from the stored crawl: the
 * facts themselves are never stored.
 *
 * The homepage's links are gone once the audit is done, so trust pages come
 * from crawled pages only. That makes the answers less strict than the
 * workflow's, never stricter.
 */
export async function loadSiteInputs(projectId: string, audit: StoredAudit) {
  const { ProjectContextRepository } =
    await import("@/server/features/project-context/repositories/ProjectContextRepository");
  const [pages, sections, crawlCompleted] = await Promise.all([
    GuidelineEvaluationRepository.getSiteInventory(audit.id),
    ProjectContextRepository.listSections(projectId),
    storedCrawlCompleted(audit),
  ]);
  const businessOverview =
    sections.find((section) => section.key === "business_overview")?.content ??
    null;
  return { pages, businessOverview, crawlCompleted, startUrl: audit.startUrl };
}

/**
 * The site facts, keeping cluster membership only for `memberUrls`: the pages
 * this call hands back or stores, the only ones that ask where they sit.
 */
export async function siteFactsFor(
  inputs: Awaited<ReturnType<typeof loadSiteInputs>>,
  memberUrls: Iterable<string>,
): Promise<SiteFacts> {
  const { buildSiteFacts } = await import("@/server/lib/guidelines/site-facts");
  return buildSiteFacts({
    pages: inputs.pages,
    startUrl: inputs.startUrl,
    crawlCompleted: inputs.crawlCompleted,
    businessOverview: inputs.businessOverview,
    memberUrlFilter: new Set(memberUrls),
  });
}

/**
 * Runs the site evaluator with the caller's answers as its judge.
 *
 * The evaluator decides which rules a judge is asked, and applies the checks
 * every site judge goes through: the evidence must be in the inventory, and a
 * doorway or scaled-content failure must rest on a cluster that looks stamped
 * out. Feeding it the caller's findings keeps the MCP path and the workflow's
 * site judge on one set of rules. With no findings, this is how the batch
 * learns which rules to hand out.
 *
 * Silence is a pass, as the batch told the caller. `notAsked` lists findings
 * on rules the evaluator never put to a judge; they are ignored.
 */
export async function judgeSite({
  facts,
  businessOverview,
  modelId,
  findings,
}: {
  facts: SiteFacts;
  businessOverview: string | null;
  modelId: string;
  findings: readonly SubmittedSiteFinding[];
}) {
  const asked: GuidelineRule[] = [];
  const judge: RuleJudge = {
    name: "mcp",
    modelId,
    judge: (input) => {
      asked.push(...input.rules);
      return Promise.resolve(
        input.rules.map((rule) => {
          const finding = findings.find((f) => f.ruleId === rule.id);
          if (!finding) return { ruleId: rule.id, status: "pass" as const };
          return {
            ruleId: rule.id,
            status: finding.status,
            evidence: finding.evidence?.slice(0, 1000) ?? null,
            reason: finding.reason?.slice(0, 1000) ?? null,
            clusters: finding.clusters ?? null,
          };
        }),
      );
    },
  };
  const { evaluateSite } =
    await import("@/server/lib/guidelines/site-evaluator");
  const evaluation = await evaluateSite({
    facts,
    businessOverview,
    languageJudge: judge,
  });
  const askedIds = new Set(asked.map((rule) => rule.id));
  return {
    evaluation,
    asked,
    notAsked: findings
      .map((finding) => finding.ruleId)
      .filter((ruleId) => !askedIds.has(ruleId)),
  };
}

/**
 * How to judge the site item. It restates the site judge's own system prompt
 * (llm-judge.ts) for an agent that never sees it, plus the corroboration
 * guard, so a caller knows why its fail may be stored as a warning.
 */
const SITE_JUDGING_NOTE =
  'Judge this item from its crawl inventory, not page text. Evidence quotes the inventory exactly: URLs, titles, title patterns or cluster ids, separated by "; ". Cite every cluster a finding rests on in `clusters`. Templated catalogs of genuinely different items (products, listings, recipes, places with their own content) are not doorways; a pattern is a problem when pages differ only in a swapped word and exist to catch each query. A doorway or scaled-content fail stands only when a cited cluster of at least 8 pages has identical text or word counts within 40 words of each other; otherwise it is stored as a warning. When the inventory cannot show the answer, answer unknown.';

/** The whole-site item of a batch, and the rules it asks. */
export async function siteBatchItem(
  facts: SiteFacts,
  businessOverview: string | null,
) {
  const [{ asked }, { renderSiteState }] = await Promise.all([
    judgeSite({ facts, businessOverview, modelId: "mcp", findings: [] }),
    import("@/server/lib/guidelines/judge"),
  ]);
  return {
    rules: asked,
    item: {
      url: facts.sentinelUrl,
      page_type: "site",
      how_to_judge: SITE_JUDGING_NOTE,
      content: renderSiteState(facts, businessOverview),
      rule_ids: asked.map((rule) => rule.id),
    },
  };
}

/** The rule SITE-04 is read off: whether the page names its author. */
const AUTHOR_RULE = "WHO-01";

/**
 * The evaluated pages as `finalizeSite` reads them, to settle SITE-04 from
 * their bylines.
 *
 * Only non-passing rules are stored, so a page with no WHO-01 finding passed
 * it only if WHO-01 was among its rules. The applicable set is not stored; it
 * is re-derived from what the row keeps (catalog version, YMYL, AI suspicion).
 * When the row cannot show that WHO-01 applied, the page did not answer it,
 * rather than passed it.
 */
export async function sitePageResults(
  auditId: string,
): Promise<SitePageResult[]> {
  const [evaluations, who01] = await Promise.all([
    GuidelineEvaluationRepository.getEvaluationsForAudit(auditId),
    GuidelineEvaluationRepository.getResultsForRules(auditId, [AUTHOR_RULE]),
  ]);
  const statusByEvaluation = new Map(
    who01.map((result) => [result.evaluationId, result.status]),
  );
  return evaluations.flatMap((evaluation) => {
    if (
      !evaluation.pageType ||
      evaluation.pageType === "site" ||
      evaluation.errorMessage
    ) {
      return [];
    }
    const asked =
      evaluation.catalogVersion === CATALOG_VERSION &&
      rulesForContext(
        { ymyl: evaluation.ymyl, aiSuspected: evaluation.aiSuspected },
        "page",
      ).some((rule) => rule.id === AUTHOR_RULE);
    const status = statusByEvaluation.get(evaluation.id);
    return [
      {
        pageType: evaluation.pageType,
        who01Status: status ?? (asked ? "pass" : null),
      },
    ];
  });
}

/**
 * The stored site row, in the shape `siteContextFor` reads, or null when the
 * audit has none.
 *
 * Which rules apply comes from the evaluator (run without a judge, which
 * costs nothing); the answers come from the stored findings. Only the pattern
 * rules are read back, since those are all a page takes from the site.
 */
export async function storedSiteEvaluation(
  auditId: string,
  facts: SiteFacts,
): Promise<PageEvaluation | null> {
  const row = await GuidelineEvaluationRepository.getSiteEvaluation(auditId);
  if (!row || row.errorMessage) return null;
  const [results, { evaluateSite }] = await Promise.all([
    GuidelineEvaluationRepository.getResultsForRules(auditId, [
      ...SITE_PATTERN_RULES,
    ]),
    import("@/server/lib/guidelines/site-evaluator"),
  ]);
  const applicable = await evaluateSite({ facts });
  return {
    ...applicable,
    judge: row.judge ?? "deterministic",
    findings: results
      .filter((result) => result.evaluationId === row.id)
      .map((result) => ({
        ruleId: result.ruleId,
        status: result.status,
        severity: result.severity,
        score: result.score,
        confidence: result.confidence,
        evidence: result.evidence,
        reason: result.reason,
        remediation: result.remediation ?? "",
      })),
  };
}
