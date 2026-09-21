/**
 * Shared plumbing for the guideline MCP tools.
 */
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { AppError } from "@/server/lib/errors";
import { rulesForContext } from "@/shared/guidelines/catalog";
import { judgeableRules } from "@/shared/guidelines/judge-map";
import type { GuidelineRule } from "@/shared/guidelines/catalog";
import type { PageClassification } from "@/server/lib/guidelines/page-evaluator";

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

/**
 * The rules a judge may answer for a page, derived from its classification.
 *
 * Both halves of the externalized-judge exchange call this: the batch tool to
 * decide what to ask, and the submit tool to check that what came back was in
 * fact asked. Deriving it in one place is what makes that check meaningful.
 */
export function applicableRulesFor(
  classification: PageClassification,
): GuidelineRule[] {
  return judgeableRules(
    rulesForContext(
      {
        ymyl: classification.ymyl,
        isReview: classification.isReview,
        hasSchema: classification.hasSchema,
        aiSuspected: classification.aiSuspected,
      },
      "page",
    ),
  );
}
