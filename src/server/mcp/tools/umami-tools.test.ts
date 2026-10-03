import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ga4ReportError } from "@/server/lib/ga4Errors";
import { UmamiNotConnectedError } from "@/server/lib/umami/umamiErrors";
import { getSearchOpportunitiesTool } from "./google-analytics-tools";
import { getUmamiOverviewTool } from "./umami-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  ga4Opportunities: vi.fn(),
  umamiOpportunities: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: async () => ({ id: "project_1" }),
  },
}));
vi.mock("@/server/features/umami/services/UmamiReportingService", () => ({
  UmamiReportingService: { getOverview: mocks.getOverview },
}));
vi.mock("@/server/features/ga4/services/SearchOpportunityService", () => ({
  SearchOpportunityService: { getOpportunities: mocks.ga4Opportunities },
}));
vi.mock(
  "@/server/features/umami/services/UmamiSearchOpportunityService",
  () => ({
    UmamiSearchOpportunityService: {
      getOpportunities: mocks.umamiOpportunities,
    },
  }),
);

const toolContext = makeToolContext();

function opportunities(source: Record<string, unknown>) {
  return {
    status: "ok",
    source,
    request: {},
    rowCount: 0,
    totalCandidateRows: 0,
    rows: [],
    scoring: {},
    coverage: { matchedRows: 0 },
    truncated: {},
    warnings: [],
    reportMetadata: {},
  };
}

describe("Umami MCP tools", () => {
  beforeEach(() => {
    mocks.getOverview.mockRejectedValue(
      new UmamiNotConnectedError("project_1"),
    );
    mocks.ga4Opportunities.mockRejectedValue(
      new Ga4ReportError(
        "ga4_not_connected",
        "Google Analytics is not connected.",
      ),
    );
    mocks.umamiOpportunities.mockResolvedValue(
      opportunities({ analytics: "umami" }),
    );
  });

  it("answers not_connected with the integrations link", async () => {
    const result = await getUmamiOverviewTool.handler(
      { projectId: "project_1", channel: "organic_search" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "not_connected",
      connectUrl:
        "https://open-seo.test/p/project_1/settings/integrations#umami",
    });
  });

  it("scores search opportunities with Umami when Google Analytics isn't connected", async () => {
    const result = await getSearchOpportunitiesTool.handler(
      { projectId: "project_1", limit: 50 },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      status: "ok",
      source: { analytics: "umami" },
    });
  });

  it("keeps Google Analytics as the source when both are connected", async () => {
    mocks.ga4Opportunities.mockResolvedValue(
      opportunities({ googleAnalyticsPropertyId: "properties/1" }),
    );

    const result = await getSearchOpportunitiesTool.handler(
      { projectId: "project_1", limit: 50 },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      source: { googleAnalyticsPropertyId: "properties/1" },
    });
    expect(mocks.umamiOpportunities).not.toHaveBeenCalled();
  });

  it("reports Google Analytics as missing when neither source is connected", async () => {
    mocks.umamiOpportunities.mockRejectedValue(
      new UmamiNotConnectedError("project_1"),
    );

    const result = await getSearchOpportunitiesTool.handler(
      { projectId: "project_1", limit: 50 },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      status: "error",
      error: { code: "ga4_not_connected" },
    });
  });
});
