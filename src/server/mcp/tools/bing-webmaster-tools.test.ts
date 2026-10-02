import { beforeEach, describe, expect, it, vi } from "vitest";
import { BingApiError } from "@/server/lib/bing/bingErrors";
import {
  getBingSearchPerformanceTool,
  syncBingNowTool,
} from "./bing-webmaster-tools";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  table: vi.fn(),
  drilldown: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/bing/services/BingPerformanceService", () => ({
  BingPerformanceService: { table: mocks.table, drilldown: mocks.drilldown },
}));
vi.mock("@/server/features/bing/services/BingSyncService", () => ({
  BingSyncService: { syncNow: mocks.syncNow },
}));

const toolContext = makeToolContext();

describe("Bing Webmaster MCP tools", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  });

  it("returns stored query rows with rounded metrics and paging", async () => {
    mocks.table.mockResolvedValue({
      connected: true,
      siteUrl: "https://example.com/",
      dimension: "query",
      range: { startDate: "2026-09-01", endDate: "2026-09-28" },
      totalCount: 3,
      rows: [
        {
          key: "seo tools",
          clicks: 12,
          impressions: 300,
          ctr: 0.04,
          avgImpressionPosition: 7.4567,
          avgClickPosition: null,
        },
      ],
    });

    const result = await getBingSearchPerformanceTool.handler(
      { projectId: "project_1", rowLimit: 1 },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: true,
      totalCount: 3,
      rows: [{ key: "seo tools", position: 7.5, clickPosition: null }],
      hasMore: true,
      nextStartRow: 1,
    });
    expect(textContent(result)).toContain("seo tools | 12 | 300 | 4.0% | 7.5");
  });

  it("answers not_connected with the integrations link", async () => {
    mocks.table.mockResolvedValue({ connected: false });

    const result = await getBingSearchPerformanceTool.handler(
      { projectId: "project_1" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "not_connected",
      connectUrl: "https://open-seo.test/p/project_1/settings/integrations#bing-webmaster",
    });
  });

  it("reports a rejected key from a live drill-down as key_invalid", async () => {
    mocks.drilldown.mockRejectedValue(
      new BingApiError("auth", "Bing rejected the API key.", 400, 3),
    );

    const result = await getBingSearchPerformanceTool.handler(
      { projectId: "project_1", query: "seo" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "key_invalid",
    });
  });

  it("refuses sync_bing_now to members who can't manage integrations", async () => {
    await expect(
      syncBingNowTool.handler(
        { projectId: "project_1" },
        makeToolContext({ role: "member" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.syncNow).not.toHaveBeenCalled();
  });
});
