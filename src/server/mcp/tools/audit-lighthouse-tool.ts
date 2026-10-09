/**
 * get_audit_lighthouse: the Lighthouse lab results a site audit stored for its
 * sample of pages — scores and metrics per page, and for one page the
 * opportunities and failing audits from the stored report in R2.
 */
import { sort } from "remeda";
import { z } from "zod";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { canonicalUrlKey } from "@/server/lib/audit/url-utils";
import { readStoredLighthousePayload } from "@/server/lib/lighthousePayload";
import { summarizeLighthouseIssues } from "@/server/lib/lighthouseStoredPayload";
import { getJsonFromR2 } from "@/server/lib/r2";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, truncatedCell } from "@/server/mcp/table";
import {
  auditIdSchema,
  resolveAudit,
} from "@/server/mcp/tools/guideline-tool-support";
import { rateWebVital } from "@/shared/web-vitals";

const STRATEGIES = ["mobile", "desktop"] as const;
const SCORE_KEYS = [
  "performance",
  "accessibility",
  "bestPractices",
  "seo",
] as const;
const CORE_VITALS = ["lcp", "cls", "inp"] as const;

const inputSchema = {
  projectId: projectIdSchema,
  auditId: auditIdSchema,
  pageUrl: z
    .string()
    .optional()
    .describe(
      "A tested page's URL: adds its top performance opportunities and the failing accessibility, best-practices and SEO audits with the offending elements. Omit to list every tested page.",
    ),
  strategy: z
    .enum(STRATEGIES)
    .optional()
    .describe(
      "Only this device. With pageUrl, defaults to mobile when both were tested.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;
type StoredRow = Awaited<
  ReturnType<typeof AuditRepository.getLighthouseResultsForAudit>
>[number]["lighthouse"] & { pageUrl: string };

function toResult(row: StoredRow) {
  return {
    pageUrl: row.pageUrl,
    strategy: row.strategy,
    performance: row.performanceScore,
    accessibility: row.accessibilityScore,
    bestPractices: row.bestPracticesScore,
    seo: row.seoScore,
    lcpMs: row.lcpMs,
    cls: row.cls,
    inpMs: row.inpMs,
    ttfbMs: row.ttfbMs,
    error: row.errorMessage,
  };
}
type Result = ReturnType<typeof toResult>;

function median(values: number[]): number {
  const sorted = sort(values, (a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Medians and minimums per category, and how many pages miss the "good"
 *  Core Web Vitals thresholds, for one strategy. */
function summarize(results: Result[]) {
  const scores = Object.fromEntries(
    SCORE_KEYS.map((key) => {
      const values = results
        .map((result) => result[key])
        .filter((value) => value !== null);
      return [
        key,
        values.length
          ? { median: median(values), min: Math.min(...values) }
          : null,
      ];
    }),
  );
  const ratings = results.map((result) => ({
    lcp: rateWebVital("lcp", result.lcpMs),
    cls: rateWebVital("cls", result.cls),
    inp: rateWebVital("inp", result.inpMs),
  }));
  const notGood = (metric: (typeof CORE_VITALS)[number]) =>
    ratings.filter((rating) => rating[metric] && rating[metric] !== "good")
      .length;
  return {
    pagesTested: results.length,
    pagesWithErrors: results.filter((result) => result.error).length,
    scores,
    coreWebVitals: {
      pagesFailing: ratings.filter((rating) =>
        CORE_VITALS.some(
          (metric) => rating[metric] && rating[metric] !== "good",
        ),
      ).length,
      lcp: notGood("lcp"),
      cls: notGood("cls"),
      inp: notGood("inp"),
    },
  };
}

const ms = (value: unknown) =>
  typeof value === "number" ? `${Math.round(value)} ms` : "—";

function resultsTable(results: Result[]): string {
  return formatMcpTable(results, [
    { header: "page", value: (row) => row.pageUrl },
    { header: "strategy", value: (row) => row.strategy },
    { header: "perf", value: (row) => row.performance },
    { header: "a11y", value: (row) => row.accessibility },
    { header: "best practices", value: (row) => row.bestPractices },
    { header: "seo", value: (row) => row.seo },
    { header: "lcp", value: (row) => row.lcpMs, format: ms },
    { header: "cls", value: (row) => row.cls },
    { header: "inp", value: (row) => row.inpMs, format: ms },
    { header: "ttfb", value: (row) => row.ttfbMs, format: ms },
    { header: "error", value: (row) => row.error, format: truncatedCell(120) },
  ]);
}

function summaryLine(
  strategy: string,
  summary: ReturnType<typeof summarize>,
): string {
  const score = (key: (typeof SCORE_KEYS)[number], label: string) => {
    const entry = summary.scores[key];
    return entry ? `${label} ${entry.median} (min ${entry.min})` : `${label} —`;
  };
  const cwv = summary.coreWebVitals;
  return `${strategy}: ${summary.pagesTested} pages — median ${score("performance", "performance")}, ${score("accessibility", "accessibility")}, ${score("bestPractices", "best practices")}, ${score("seo", "SEO")}. Over the Core Web Vitals "good" thresholds: ${cwv.pagesFailing} pages (LCP ${cwv.lcp}, CLS ${cwv.cls}, INP ${cwv.inp}).${summary.pagesWithErrors ? ` ${summary.pagesWithErrors} checks failed.` : ""}`;
}

/** The stored report's lab metrics and issue summary, or why it can't be read. */
async function readDetail(row: StoredRow) {
  if (!row.r2Key) {
    return {
      detail: null,
      detailUnavailable: row.errorMessage
        ? "The Lighthouse check failed, so no report was stored."
        : "No Lighthouse report was stored for this check.",
    };
  }
  try {
    const { storedPayload } = readStoredLighthousePayload(
      await getJsonFromR2(row.r2Key),
    );
    if (!storedPayload) {
      return {
        detail: null,
        detailUnavailable:
          "The stored Lighthouse report is in an older format OpenSEO can no longer read.",
      };
    }
    return {
      detail: {
        finalUrl: storedPayload.metadata.finalUrl,
        fetchedAt: storedPayload.metadata.fetchedAt,
        lab: storedPayload.metrics,
        ...summarizeLighthouseIssues(storedPayload.issues),
      },
      detailUnavailable: null,
    };
  } catch {
    return {
      detail: null,
      detailUnavailable: "The stored Lighthouse report could not be read.",
    };
  }
}

export const getAuditLighthouseTool = {
  name: "get_audit_lighthouse",
  config: {
    title: "Get site audit Lighthouse results",
    description:
      "Read the Lighthouse lab results a site audit stored for its sample of pages (run_site_audit with runLighthouse). Without pageUrl: one row per tested page and device with the performance, accessibility, best-practices and SEO scores, LCP, CLS, INP and TTFB, worst performance first, plus medians, minimums and how many pages miss the Core Web Vitals thresholds. With pageUrl: that page's top performance opportunities with estimated savings, and its failing accessibility, best-practices and SEO audits with the offending elements. This is lab data from one run per page; use get_core_web_vitals for real-user field data and run_pagespeed for a fresh run on any URL. Free — reads OpenSEO state. Omit auditId for the most recent audit.",
    inputSchema,
    outputSchema: z
      .object({
        auditId: z.string(),
        results: z.array(looseObjectOutputSchema),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const audit = await resolveAudit(args.projectId, args.auditId);
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/audit?auditId=${audit.id}&tab=performance`,
    );
    const rows: StoredRow[] = (
      await AuditRepository.getLighthouseResultsForAudit(audit.id)
    )
      .map(({ lighthouse, pageUrl }) => ({ ...lighthouse, pageUrl }))
      .filter((row) => !args.strategy || row.strategy === args.strategy);

    if (rows.length === 0) {
      return mcpResponse({
        text:
          audit.status === "running"
            ? `Audit ${audit.id} is still running; Lighthouse results appear once its checks finish. Wait with get_audit_status.`
            : `Audit ${audit.id} has no Lighthouse results${args.strategy ? ` for ${args.strategy}` : ""}. Start an audit with run_site_audit and runLighthouse: true, or use run_pagespeed for one URL.`,
        meta,
        structuredContent: { auditId: audit.id, results: [] },
      });
    }

    if (args.pageUrl) {
      const key = canonicalUrlKey(args.pageUrl);
      const matches = rows.filter(
        (row) => canonicalUrlKey(row.pageUrl) === key,
      );
      const row =
        matches.find((match) => match.strategy === "mobile") ?? matches[0];
      if (!row) {
        const tested = [...new Set(rows.map((r) => r.pageUrl))];
        return mcpResponse({
          text: `Lighthouse did not test ${args.pageUrl} in audit ${audit.id}. Tested pages: ${tested.join(", ")}. Use run_pagespeed for any other URL.`,
          meta,
          structuredContent: { auditId: audit.id, results: [] },
        });
      }

      const result = toResult(row);
      const { detail, detailUnavailable } = await readDetail(row);
      const lines = [
        `Lighthouse (lab, ${row.strategy}) for ${row.pageUrl} in audit ${audit.id}:`,
        resultsTable([result]),
      ];
      const other = matches.find((match) => match !== row);
      if (other) {
        lines.push(
          `Also tested on ${other.strategy}: pass strategy to read it.`,
        );
      }
      if (!detail) {
        lines.push("", `${detailUnavailable} Scores above are still valid.`);
      } else {
        const { lab } = detail;
        lines.push(
          `Lab: FCP ${lab.firstContentfulPaint.displayValue ?? "—"}, LCP ${lab.largestContentfulPaint.displayValue ?? "—"}, TBT ${lab.totalBlockingTime.displayValue ?? "—"}, CLS ${lab.cumulativeLayoutShift.displayValue ?? "—"}, Speed Index ${lab.speedIndex.displayValue ?? "—"}, server response ${lab.serverResponseTime.displayValue ?? "—"}.`,
        );
        if (detail.opportunities.length > 0) {
          lines.push(
            "",
            "Top performance opportunities:",
            formatMcpTable(detail.opportunities, [
              { header: "audit", value: (o) => o.title },
              { header: "detail", value: (o) => o.displayValue },
              { header: "savings (ms)", value: (o) => o.savingsMs },
              { header: "savings (bytes)", value: (o) => o.savingsBytes },
              { header: "severity", value: (o) => o.severity },
            ]),
          );
        }
        if (detail.otherIssues.length > 0) {
          lines.push(
            "",
            "Failing audits in other categories (offending items in structuredContent.detail.otherIssues):",
            formatMcpTable(detail.otherIssues, [
              { header: "category", value: (i) => i.category },
              { header: "audit", value: (i) => i.title },
              { header: "severity", value: (i) => i.severity },
              { header: "items", value: (i) => i.items.length },
            ]),
          );
        }
      }
      return mcpResponse({
        text: lines.join("\n"),
        meta,
        structuredContent: {
          auditId: audit.id,
          results: [result],
          detail,
          detailUnavailable,
        },
      });
    }

    // Worst performance first; checks without a score (failed) last.
    const results = sort(
      rows.map(toResult),
      (a, b) => (a.performance ?? 101) - (b.performance ?? 101),
    );
    const summary = Object.fromEntries(
      STRATEGIES.flatMap((strategy) => {
        const forStrategy = results.filter((r) => r.strategy === strategy);
        return forStrategy.length ? [[strategy, summarize(forStrategy)]] : [];
      }),
    );
    return mcpResponse({
      text: [
        `Lighthouse lab results for audit ${audit.id} (${audit.startUrl}), ${results.length} checks.`,
        ...Object.entries(summary).map(([strategy, entry]) =>
          summaryLine(strategy, entry),
        ),
        resultsTable(results),
        "Call again with pageUrl for a page's opportunities and failing audits.",
      ].join("\n"),
      meta,
      structuredContent: { auditId: audit.id, results, summary },
    });
  }),
};
