import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitUrlsForIndexingTool } from "./indexing-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  submitUrls: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/indexing/UrlSubmissionService", () => ({
  UrlSubmissionService: { submitUrls: mocks.submitUrls },
}));

const args = { projectId: "project_1", urls: ["https://example.com/a"] };

describe("submit_urls_for_indexing", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
    mocks.submitUrls.mockResolvedValue({
      batchId: "batch_1",
      channel: "indexnow",
      problem: null,
      results: [
        {
          url: "https://example.com/a",
          status: "received",
          channel: "indexnow",
          httpStatus: 200,
          errorMessage: null,
        },
      ],
      counts: { received: 1 },
      dropped: [],
    });
  });

  it("records MCP submissions under the mcp source", async () => {
    const result = await submitUrlsForIndexingTool.handler(
      args,
      makeToolContext(),
    );

    expect(mocks.submitUrls).toHaveBeenCalledWith(
      "project_1",
      ["https://example.com/a"],
      "mcp",
      { channel: undefined, force: undefined },
    );
    expect(result.structuredContent).toMatchObject({
      ok: true,
      counts: { received: 1 },
    });
  });

  it("refuses members who cannot manage integrations", async () => {
    await expect(
      submitUrlsForIndexingTool.handler(
        args,
        makeToolContext({ role: "member" }),
      ),
    ).rejects.toThrow("organization role");
    expect(mocks.submitUrls).not.toHaveBeenCalled();
  });
});
