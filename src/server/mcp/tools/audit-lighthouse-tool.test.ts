import { beforeEach, expect, it, vi } from "vitest";
import { getAuditLighthouseTool } from "./audit-lighthouse-tool";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getLatestAuditForProject: vi.fn(),
  getLighthouseResultsForAudit: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: mocks,
}));

const check = (
  pageUrl: string,
  performanceScore: number | null,
  lcpMs: number | null,
  errorMessage: string | null = null,
) => ({
  pageUrl,
  lighthouse: {
    strategy: "mobile",
    performanceScore,
    accessibilityScore: performanceScore,
    bestPracticesScore: null,
    seoScore: 100,
    lcpMs,
    cls: 0.02,
    inpMs: null,
    ttfbMs: 300,
    errorMessage,
  },
});

beforeEach(() => {
  mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  mocks.getLatestAuditForProject.mockResolvedValue({
    id: "audit_1",
    startUrl: "https://example.com/",
    status: "completed",
  });
  mocks.getLighthouseResultsForAudit.mockResolvedValue([
    check("https://example.com/", 90, 1800),
    check("https://example.com/broken", null, null, "NO_FCP"),
    check("https://example.com/blog", 40, 5200),
    check("https://example.com/shop", 70, 3000),
  ]);
});

it("lists checks worst performance first and summarizes each strategy", async () => {
  const response = await getAuditLighthouseTool.handler(
    { projectId: "project_1" },
    makeToolContext(),
  );

  expect(response.structuredContent).toMatchObject({
    auditId: "audit_1",
    results: [
      { pageUrl: "https://example.com/blog", performance: 40 },
      { pageUrl: "https://example.com/shop", performance: 70 },
      { pageUrl: "https://example.com/", performance: 90 },
      { pageUrl: "https://example.com/broken", error: "NO_FCP" },
    ],
    summary: {
      mobile: {
        pagesTested: 4,
        pagesWithErrors: 1,
        scores: {
          performance: { median: 70, min: 40 },
          bestPractices: null,
        },
        // LCP 3000 needs improvement and 5200 is poor; CLS is good everywhere.
        coreWebVitals: { pagesFailing: 2, lcp: 2, cls: 0, inp: 0 },
      },
    },
  });
});
