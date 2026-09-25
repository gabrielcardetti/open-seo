/**
 * Shared plumbing for the guideline MCP tools.
 */
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { AppError } from "@/server/lib/errors";

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
