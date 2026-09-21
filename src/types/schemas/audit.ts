import { z } from "zod";
import {
  DEFAULT_AUDIT_PAGES,
  MIN_AUDIT_PAGES,
  PAID_MAX_AUDIT_PAGES,
} from "@/shared/audit-limits";

// ─── Server function input schemas ──────────────────────────────────────────

export const startAuditSchema = z.object({
  projectId: z.string().min(1),
  startUrl: z.string().min(1, "URL is required").max(2048),
  maxPages: z
    .number()
    .int()
    .min(MIN_AUDIT_PAGES)
    .max(PAID_MAX_AUDIT_PAGES)
    .optional()
    .default(DEFAULT_AUDIT_PAGES),
  lighthouseStrategy: z.enum(["auto", "none"]).optional().default("auto"),
  // Off by default: the guideline phase spends judge calls, so it is opted
  // into rather than imposed on every audit.
  guidelinesStrategy: z
    .enum(["none", "sample", "all"])
    .optional()
    .default("none"),
});

export const getGuidelineResultsSchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1),
});

export const getAuditStatusSchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1),
});

export const getAuditResultsSchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1),
});

export const getAuditHistorySchema = z.object({
  projectId: z.string().min(1),
});

export const deleteAuditSchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1),
});

export const getCrawlProgressSchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1),
});

// ─── URL search params schema for /p/$projectId/audit ────────────────────────

const auditTabs = ["issues", "pages", "performance", "guidelines"] as const;

export const auditSearchSchema = z.object({
  auditId: z.string().optional().catch(undefined),
  tab: z.enum(auditTabs).catch("issues").default("issues"),
});
