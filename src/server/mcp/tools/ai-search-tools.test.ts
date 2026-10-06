import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exploreAiPromptTool,
  getAiBrandVisibilityTool,
} from "./ai-search-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  customerHasPaidPlan: vi.fn(),
  getBrandLookup: vi.fn(),
  explorePrompt: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));

vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: mocks.customerHasPaidPlan,
}));

vi.mock("@/server/features/ai-search/services/brandLookup", () => ({
  getBrandLookup: mocks.getBrandLookup,
}));

vi.mock("@/server/features/ai-search/services/promptExplorer", () => ({
  explorePrompt: mocks.explorePrompt,
}));

const toolContext = makeToolContext();

beforeEach(() => {
  mocks.getProjectForOrganization.mockResolvedValue({
    id: "project_1",
    domain: "example.es",
    locationCode: 2724,
    languageCode: "es",
  });
  mocks.isHostedServerAuthMode.mockResolvedValue(true);
  mocks.customerHasPaidPlan.mockResolvedValue(false);
});

// Each call fans out to several paid DataForSEO requests, so the hosted
// free tier must be refused before any of them is made.
describe("AI search tools on the hosted free tier", () => {
  it("refuses brand visibility before calling DataForSEO", async () => {
    await expect(
      getAiBrandVisibilityTool.handler({ projectId: "project_1" }, toolContext),
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(mocks.getBrandLookup).not.toHaveBeenCalled();
  });

  it("refuses prompt exploration before calling DataForSEO", async () => {
    await expect(
      exploreAiPromptTool.handler(
        { projectId: "project_1", prompt: "best ope app", models: ["claude"] },
        toolContext,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(mocks.explorePrompt).not.toHaveBeenCalled();
  });
});
