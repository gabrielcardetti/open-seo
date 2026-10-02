import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { getGuidelineResultsTool } from "./guideline-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getAuditForProject: vi.fn(),
  getEvaluationResultsForProject: vi.fn(),
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
vi.mock(
  "@/server/features/audit/repositories/GuidelineEvaluationRepository",
  () => ({ GuidelineEvaluationRepository: mocks }),
);

const result = (ruleId: string, status: string, severity: string) => ({
  evaluationId: "evaluation_1",
  ruleId,
  status,
  severity,
  evidence: null,
  reason: null,
  remediation: null,
});

beforeEach(() => {
  mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  mocks.getAuditForProject.mockResolvedValue({
    id: "audit_1",
    config: JSON.stringify({
      maxPages: 50,
      lighthouseStrategy: "none",
      guidelineEngines: ["google", "bing"],
    }),
  });
  mocks.getEvaluationResultsForProject.mockResolvedValue({
    evaluations: [
      {
        id: "evaluation_1",
        pageUrl: "https://example.com/a",
        pageType: "article",
        // Stored across both engines; each engine's is recomputed.
        verdict: "revise",
        errorMessage: null,
      },
    ],
    results: [
      result("PF-W10", "unknown", "high"),
      result("BING-30", "unknown", "critical"),
      result("BING-07", "fail", "high"),
      result("BING-17", "fail", "medium"),
    ],
  });
});

// A Bing-only failure must not touch the Google verdict, and a rule where
// Bing and Google disagree is reported as such, not as a failure.
it("reports each engine's verdict side by side", async () => {
  const response = await getGuidelineResultsTool.handler(
    { projectId: "project_1", auditId: "audit_1", limit: 10 },
    makeToolContext(),
  );
  const [page] = z
    .array(
      z.object({
        verdict: z.string(),
        verdicts: z.record(z.string(), z.string()),
        findings: z.array(z.object({ rule: z.string(), status: z.string() })),
      }),
    )
    .parse(response.structuredContent?.pages);
  expect(page.verdict).toBe("pass");
  expect(page.verdicts).toEqual({ google: "pass", bing: "revise" });
  expect(page.findings.find((f) => f.rule === "BING-17")?.status).toBe(
    "conflict",
  );
});
