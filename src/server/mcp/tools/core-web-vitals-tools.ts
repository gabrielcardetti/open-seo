/**
 * MCP tools for Google's own Core Web Vitals numbers: Chrome UX Report field
 * data (with its weekly history) and PageSpeed Insights runs. Free — they use
 * the deployment's Google API key, not OpenSEO credits.
 */
import { z } from "zod";
import {
  CoreWebVitalsService,
  CRUX_API_KEY_ENV,
  CRUX_SETUP_DOCS_URL,
  type FieldMetric,
} from "@/server/features/core-web-vitals/CoreWebVitalsService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import { GoogleApiError } from "@/server/lib/googleWebVitalsClient";
import type { WebVital } from "@/shared/web-vitals";

const DEVICE_TO_FORM_FACTOR = {
  mobile: "PHONE",
  desktop: "DESKTOP",
  all: "ALL",
} as const;

const outputSchema = z
  .object({
    ok: z.boolean(),
    reason: z.string().optional(),
    ...optionalMetaOutputSchema,
  })
  .passthrough();

type Meta = ReturnType<typeof buildProjectMeta>;

function notConfigured(meta: Meta) {
  return mcpResponse({
    text: `Core Web Vitals field data needs a Google API key on this OpenSEO deployment. Set ${CRUX_API_KEY_ENV} (a Google Cloud API key with the Chrome UX Report API and PageSpeed Insights API enabled). Setup: ${CRUX_SETUP_DOCS_URL}`,
    meta,
    structuredContent: {
      ok: false,
      reason: "not_configured",
      setupDocsUrl: CRUX_SETUP_DOCS_URL,
    },
  });
}

function googleError(error: unknown, meta: Meta) {
  if (!(error instanceof GoogleApiError)) throw error;
  const hint =
    error.status === 403
      ? " Check that the Chrome UX Report API and PageSpeed Insights API are enabled for the key's Google Cloud project, and that the key isn't restricted to other APIs."
      : error.status === 429
        ? " Google's per-minute quota was hit; try again in a minute."
        : "";
  return mcpResponse({
    text: `Google returned an error (${error.status}): ${error.message}.${hint}`,
    meta,
    structuredContent: {
      ok: false,
      reason: "google_api_error",
      status: error.status,
      message: error.message,
    },
  });
}

function formatVital(metric: WebVital, value: number | null): string {
  if (value === null) return "—";
  if (metric === "cls") return value.toFixed(2);
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : `${Math.round(value)} ms`;
}

const percent = (value: unknown) =>
  typeof value === "number" ? `${Math.round(value * 100)}%` : "—";

function metricsTable(metrics: FieldMetric[]): string {
  return formatMcpTable(metrics, [
    { header: "metric", value: (row) => row.metric },
    { header: "p75", value: (row) => formatVital(row.metric, row.p75) },
    { header: "rating", value: (row) => row.rating },
    { header: "good", value: (row) => row.good, format: percent },
    {
      header: "needs improvement",
      value: (row) => row.needsImprovement,
      format: percent,
    },
    { header: "poor", value: (row) => row.poor, format: percent },
  ]);
}

const assessmentText = (assessment: "passed" | "failed" | null) =>
  assessment === null
    ? "not enough data for an assessment"
    : `Core Web Vitals assessment ${assessment.toUpperCase()}`;

// ---------------------------------------------------------------------------
// get_core_web_vitals
// ---------------------------------------------------------------------------

const fieldShape = {
  projectId: projectIdSchema,
  url: z
    .string()
    .url()
    .optional()
    .describe(
      "A page URL for page-level data. Falls back to the page's origin when Google has too little traffic for the page itself.",
    ),
  origin: z
    .string()
    .url()
    .optional()
    .describe(
      "An origin such as https://www.example.com (any site, e.g. a competitor). Omit both url and origin for the project's own site; its www and bare origins are both tried.",
    ),
  device: z
    .enum(["mobile", "desktop", "all"])
    .optional()
    .describe(
      "Device the data comes from. Defaults to mobile, which Google indexes with.",
    ),
  includeHistory: z
    .boolean()
    .optional()
    .describe(
      "Add the weekly history: the p75 of each metric over the last 25 weekly 28-day windows. Defaults to true.",
    ),
};

export const getCoreWebVitalsTool = {
  name: "get_core_web_vitals",
  config: {
    title: "Get Core Web Vitals (CrUX)",
    description:
      "Google's own Core Web Vitals field data from the Chrome UX Report: the 75th percentile of real Chrome users over the last 28 days for LCP, INP, CLS, FCP and TTFB, each rated good / needs improvement / poor, the share of page loads in each bucket, and Google's pass/fail assessment — the numbers behind Search's page experience signals. Optionally a weekly history (~6 months) to see whether a fix moved them. Works for the project's site, any page URL, or any origin. Sites with little Chrome traffic have no data. Free — uses the deployment's Google API key, no credits.",
    inputSchema: fieldShape,
    outputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof fieldShape>>, context) => {
      const meta = buildProjectMeta(context, args.projectId);
      if (!(await CoreWebVitalsService.isConfigured())) {
        return notConfigured(meta);
      }
      const domain = context.project.domain;
      const target = args.url
        ? { url: args.url }
        : args.origin
          ? { origin: args.origin }
          : domain
            ? { projectDomain: domain }
            : null;
      if (!target) {
        return mcpResponse({
          text: "This project has no domain. Pass a url or an origin.",
          meta,
          structuredContent: { ok: false, reason: "invalid_request" },
        });
      }

      try {
        const result = await CoreWebVitalsService.getFieldData({
          ...target,
          formFactor: DEVICE_TO_FORM_FACTOR[args.device ?? "mobile"],
          includeHistory: args.includeHistory ?? true,
        });
        if (!result.found) {
          return mcpResponse({
            text: `The Chrome UX Report has no ${args.device ?? "mobile"} data for ${result.tried.join(" or ")}: Google publishes it only for pages and origins with enough Chrome traffic. Try device "all", the origin instead of a page, or run_pagespeed for lab data.`,
            meta,
            structuredContent: { ok: true, ...result },
          });
        }

        const lines = [
          `Chrome UX Report (${result.scope === "url" ? "page" : "origin"}) for ${result.target}, ${args.device ?? "mobile"}${result.collectionPeriod ? `, ${result.collectionPeriod.firstDate} to ${result.collectionPeriod.lastDate}` : ""}: ${assessmentText(result.assessment)}.`,
          ...("url" in target && result.scope === "origin"
            ? [
                "The page has too little traffic for its own data; these are its origin's numbers.",
              ]
            : []),
          metricsTable(result.metrics),
        ];
        if (result.history?.length) {
          lines.push(
            "",
            "Weekly history (p75, oldest first):",
            formatMcpTable(result.history, [
              { header: "week ending", value: (row) => row.endDate },
              { header: "lcp", value: (row) => formatVital("lcp", row.lcp) },
              { header: "inp", value: (row) => formatVital("inp", row.inp) },
              { header: "cls", value: (row) => formatVital("cls", row.cls) },
              { header: "fcp", value: (row) => formatVital("fcp", row.fcp) },
              {
                header: "ttfb",
                value: (row) => formatVital("ttfb", row.ttfb),
              },
            ]),
          );
        }
        return mcpResponse({
          text: lines.join("\n"),
          meta,
          structuredContent: { ok: true, ...result },
        });
      } catch (error) {
        return googleError(error, meta);
      }
    },
  ),
};

// ---------------------------------------------------------------------------
// run_pagespeed
// ---------------------------------------------------------------------------

const pagespeedShape = {
  projectId: projectIdSchema,
  url: z.string().url().describe("Absolute URL of the page to test."),
  strategy: z
    .enum(["mobile", "desktop"])
    .optional()
    .describe("Emulated device. Defaults to mobile."),
};

export const runPagespeedTool = {
  name: "run_pagespeed",
  config: {
    title: "Run PageSpeed Insights",
    description:
      "Run Google PageSpeed Insights on one URL: Lighthouse scores (performance, accessibility, best practices, SEO), lab metrics, the top performance opportunities ranked by estimated savings, the main failing audits in the other categories, and the Chrome UX Report field data Google shows beside them (the page's own, or its origin's). Takes 20-60 seconds. Use get_core_web_vitals for the field-data trend. Free — uses the deployment's Google API key, no credits.",
    inputSchema: pagespeedShape,
    outputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof pagespeedShape>>, context) => {
      const meta = buildProjectMeta(context, args.projectId);
      if (!(await CoreWebVitalsService.isConfigured())) {
        return notConfigured(meta);
      }
      try {
        const result = await CoreWebVitalsService.runPagespeed({
          url: args.url,
          strategy: args.strategy ?? "mobile",
        });
        const { scores, lab } = result;
        const lines = [
          `PageSpeed Insights (${result.strategy}) for ${result.finalUrl}: performance ${scores.performance ?? "—"}, accessibility ${scores.accessibility ?? "—"}, best practices ${scores.bestPractices ?? "—"}, SEO ${scores.seo ?? "—"}.`,
          `Lab: FCP ${lab.firstContentfulPaint.displayValue ?? "—"}, LCP ${lab.largestContentfulPaint.displayValue ?? "—"}, TBT ${lab.totalBlockingTime.displayValue ?? "—"}, CLS ${lab.cumulativeLayoutShift.displayValue ?? "—"}, Speed Index ${lab.speedIndex.displayValue ?? "—"}, server response ${lab.serverResponseTime.displayValue ?? "—"}.`,
        ];
        if (result.field) {
          lines.push(
            "",
            `Field data (${result.field.scope === "url" ? "this page" : "origin"}, Chrome UX Report): ${assessmentText(result.field.assessment)}.`,
            metricsTable(result.field.metrics),
          );
        } else {
          lines.push(
            "",
            "No Chrome UX Report field data for this page or its origin.",
          );
        }
        if (result.opportunities.length > 0) {
          lines.push(
            "",
            "Top performance opportunities:",
            formatMcpTable(result.opportunities, [
              { header: "audit", value: (row) => row.title },
              { header: "detail", value: (row) => row.displayValue },
              { header: "savings (ms)", value: (row) => row.savingsMs },
              { header: "savings (bytes)", value: (row) => row.savingsBytes },
              { header: "severity", value: (row) => row.severity },
            ]),
          );
        }
        if (result.otherIssues.length > 0) {
          lines.push(
            "",
            "Failing audits in other categories:",
            formatMcpTable(result.otherIssues, [
              { header: "category", value: (row) => row.category },
              { header: "audit", value: (row) => row.title },
              { header: "severity", value: (row) => row.severity },
            ]),
          );
        }
        return mcpResponse({
          text: lines.join("\n"),
          meta,
          structuredContent: { ok: true, ...result },
        });
      } catch (error) {
        return googleError(error, meta);
      }
    },
  ),
};
