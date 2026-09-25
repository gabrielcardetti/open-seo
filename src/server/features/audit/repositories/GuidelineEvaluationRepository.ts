/**
 * Data access for the content-guideline evaluation tables.
 *
 * Separate from AuditRepository, which is already at the repo's file-size
 * limit — the same reason auditSummaryQueries.ts exists.
 *
 * Every write is idempotent: ids are derived from stable content and rows go in
 * with `onConflictDoNothing`, because persistence happens inside Workflow steps
 * that retry.
 */
import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditPageEvaluations,
  auditPages,
  auditRuleResults,
  audits,
} from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";
import { deterministicAuditRowId } from "@/server/lib/audit/ids";
import { DECISION_MODEL_IDS } from "@/server/lib/guidelines/decision-transport";
import type { PageEvaluation } from "@/server/lib/guidelines/page-evaluator";

/** The stored page type of the one row per audit that judges the whole site. */
const SITE_PAGE_TYPE = "site";

interface StoredEvaluationInput {
  auditId: string;
  pageId: string | null;
  evaluation: PageEvaluation;
}

/**
 * Persist one page's evaluation and its non-passing rules.
 *
 * Findings are replaced rather than merged on a re-run: a rule that stopped
 * failing must not leave a stale row behind claiming it still does.
 */
async function insertEvaluations(inputs: StoredEvaluationInput[]) {
  if (inputs.length === 0) return;

  const evaluationRows = await Promise.all(
    inputs.map(async ({ auditId, pageId, evaluation }) => ({
      id: await deterministicAuditRowId(auditId, evaluation.url, "evaluation"),
      auditId,
      pageId,
      pageUrl: evaluation.url,
      catalogVersion: evaluation.catalogVersion,
      pageType: evaluation.classification.pageType,
      ymyl: evaluation.classification.ymyl,
      ymylTopicsJson: JSON.stringify(evaluation.classification.ymylTopics),
      aiSuspected: evaluation.classification.aiSuspected,
      verdict: evaluation.verdict,
      criticalFails: evaluation.criticalFails,
      highFails: evaluation.highFails,
      mediumFails: evaluation.mediumFails,
      lowFails: evaluation.lowFails,
      unknownCount: evaluation.unknownCount,
      judge: evaluation.judge,
      errorMessage: null as string | null,
    })),
  );

  const ruleRows = (
    await Promise.all(
      inputs.map(async ({ auditId, evaluation }) => {
        const evaluationId = await deterministicAuditRowId(
          auditId,
          evaluation.url,
          "evaluation",
        );
        return Promise.all(
          evaluation.findings.map(async (finding) => ({
            id: await deterministicAuditRowId(
              auditId,
              evaluation.url,
              finding.ruleId,
            ),
            auditId,
            evaluationId,
            pageUrl: evaluation.url,
            ruleId: finding.ruleId,
            status: finding.status,
            severity: finding.severity,
            score: finding.score,
            confidence: finding.confidence,
            evidence: finding.evidence,
            reason: finding.reason,
            remediation: finding.remediation,
          })),
        );
      }),
    )
  ).flat();

  // Clear prior findings for these evaluations first, so a re-run cannot leave
  // a resolved rule behind.
  const evaluationIds = evaluationRows.map((row) => row.id);
  await executeInBatches(evaluationIds, (tx, id) =>
    tx.delete(auditRuleResults).where(eq(auditRuleResults.evaluationId, id)),
  );

  await executeInBatches(evaluationRows, (tx, row) =>
    tx
      .insert(auditPageEvaluations)
      .values(row)
      .onConflictDoUpdate({
        target: auditPageEvaluations.id,
        set: {
          verdict: row.verdict,
          criticalFails: row.criticalFails,
          highFails: row.highFails,
          mediumFails: row.mediumFails,
          lowFails: row.lowFails,
          unknownCount: row.unknownCount,
          judge: row.judge,
          catalogVersion: row.catalogVersion,
          errorMessage: row.errorMessage,
        },
      }),
  );

  await executeInBatches(ruleRows, (tx, row) =>
    tx.insert(auditRuleResults).values(row).onConflictDoNothing(),
  );
}

/** Record that a page could not be evaluated, so the attempt is not invisible. */
async function insertFailedEvaluation(input: {
  auditId: string;
  pageId: string | null;
  pageUrl: string;
  catalogVersion: string;
  errorMessage: string;
  /** "site" for the whole-site row, so readers still tell it from a page. */
  pageType?: string | null;
}) {
  const id = await deterministicAuditRowId(
    input.auditId,
    input.pageUrl,
    "evaluation",
  );
  await db
    .insert(auditPageEvaluations)
    .values({
      id,
      auditId: input.auditId,
      pageId: input.pageId,
      pageUrl: input.pageUrl,
      catalogVersion: input.catalogVersion,
      pageType: input.pageType ?? null,
      ymyl: false,
      ymylTopicsJson: null,
      aiSuspected: false,
      // A page we could not read is not a page that passed.
      verdict: "revise" as const,
      criticalFails: 0,
      highFails: 0,
      mediumFails: 0,
      lowFails: 0,
      unknownCount: 0,
      judge: null,
      errorMessage: input.errorMessage.slice(0, 500),
    })
    .onConflictDoNothing();
}

async function getEvaluationsForAudit(auditId: string) {
  return db
    .select()
    .from(auditPageEvaluations)
    .where(eq(auditPageEvaluations.auditId, auditId));
}

async function getRuleResultsForAudit(auditId: string) {
  return db
    .select()
    .from(auditRuleResults)
    .where(eq(auditRuleResults.auditId, auditId));
}

/** Evaluations plus findings for one audit, scoped to the owning project. */
async function getEvaluationResultsForProject(
  auditId: string,
  projectId: string,
) {
  const audit = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(eq(audits.id, auditId), eq(audits.projectId, projectId)))
    .limit(1);
  if (audit.length === 0) return null;

  const [evaluations, results] = await Promise.all([
    getEvaluationsForAudit(auditId),
    getRuleResultsForAudit(auditId),
  ]);
  return { evaluations, results };
}

/**
 * URLs that already carry a judged verdict, so the externalized judge skips
 * them.
 *
 * A row counts only when a judge that reads the page answered. Rows settled by
 * the deterministic rules alone, or by a decision model alone (verdicts with no
 * quote and no reason), are exactly the pages an external judge should pick
 * up, not skip.
 */
async function getJudgedUrls(auditId: string): Promise<Set<string>> {
  const rows = await db
    .select({ pageUrl: auditPageEvaluations.pageUrl })
    .from(auditPageEvaluations)
    .where(
      and(
        eq(auditPageEvaluations.auditId, auditId),
        isNotNull(auditPageEvaluations.judge),
        notInArray(auditPageEvaluations.judge, [
          "deterministic",
          ...DECISION_MODEL_IDS,
        ]),
        isNull(auditPageEvaluations.errorMessage),
      ),
    );
  return new Set(rows.map((row) => row.pageUrl));
}

async function deleteEvaluationsForAudit(auditId: string) {
  await db
    .delete(auditRuleResults)
    .where(eq(auditRuleResults.auditId, auditId));
  await db
    .delete(auditPageEvaluations)
    .where(eq(auditPageEvaluations.auditId, auditId));
}

/**
 * Every crawled page of an audit, with only the columns the site pass and the
 * guideline sampler read. The body hash is here and not in
 * `AuditRepository.getPagesForAudit`: it is what lets the sampler judge one of
 * several identical pages and the site pass find exact-duplicate clusters.
 */
async function getSiteInventory(auditId: string) {
  return db
    .select({
      id: auditPages.id,
      url: auditPages.url,
      statusCode: auditPages.statusCode,
      fetchClass: auditPages.fetchClass,
      isIndexable: auditPages.isIndexable,
      title: auditPages.title,
      wordCount: auditPages.wordCount,
      contentHash: auditPages.contentHash,
      crawlDepth: auditPages.crawlDepth,
    })
    .from(auditPages)
    .where(eq(auditPages.auditId, auditId));
}

/** The whole-site evaluation row, or null when the site was not evaluated. */
async function getSiteEvaluation(auditId: string) {
  const [row] = await db
    .select()
    .from(auditPageEvaluations)
    .where(
      and(
        eq(auditPageEvaluations.auditId, auditId),
        eq(auditPageEvaluations.pageType, SITE_PAGE_TYPE),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Findings for specific rules, used by the site-level rollup. */
async function getResultsForRules(auditId: string, ruleIds: string[]) {
  if (ruleIds.length === 0) return [];
  return db
    .select()
    .from(auditRuleResults)
    .where(
      and(
        eq(auditRuleResults.auditId, auditId),
        inArray(auditRuleResults.ruleId, ruleIds),
      ),
    );
}

export const GuidelineEvaluationRepository = {
  insertEvaluations,
  insertFailedEvaluation,
  getEvaluationsForAudit,
  getRuleResultsForAudit,
  getEvaluationResultsForProject,
  getJudgedUrls,
  deleteEvaluationsForAudit,
  getResultsForRules,
  getSiteInventory,
  getSiteEvaluation,
} as const;
