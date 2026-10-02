import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitAuditChanges } from "./auditChanges";
import { IndexingRepository } from "./IndexingRepository";
import { resetTestDatabase } from "./indexing-test-db";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getPageHashesForAudit: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => ({
  db: (await import("./indexing-test-db")).testDb,
}));
vi.mock("@/db/runBatch", async () => ({
  executeInBatches: (await import("./indexing-test-db")).executeSequentially,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: mocks.getProjectById },
}));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {
    getAuditForProject: () =>
      Promise.resolve({ id: "audit-2", startUrl: "https://example.com/" }),
  },
}));
vi.mock(
  "@/server/features/audit/repositories/AuditComparisonRepository",
  () => ({
    AuditComparisonRepository: {
      getPreviousCompletedAudits: () =>
        Promise.resolve([{ id: "audit-1", startUrl: "https://example.com/" }]),
      getPageHashesForAudit: mocks.getPageHashesForAudit,
    },
  }),
);

const page = (path: string, contentHash: string) => ({
  url: `https://example.com${path}`,
  statusCode: 200,
  isIndexable: true,
  contentHash,
});

describe("submitAuditChanges", () => {
  beforeEach(async () => {
    resetTestDatabase();
    mocks.getProjectById.mockResolvedValue({
      id: "project-1",
      domain: "example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
    await IndexingRepository.upsertSettings("project-1", {
      indexnowKey: "a1b2c3d4e5f6a7b8",
      indexnowVerifiedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("sends only pages both audits crawled whose content changed, not pages the earlier crawl missed", async () => {
    mocks.getPageHashesForAudit.mockImplementation((auditId: string) =>
      Promise.resolve(
        auditId === "audit-1"
          ? [page("/edited", "h1"), page("/same", "h1")]
          : [page("/edited", "h2"), page("/same", "h1"), page("/unseen", "h1")],
      ),
    );

    await submitAuditChanges({ projectId: "project-1", auditId: "audit-2" });

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const body: unknown = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    );
    expect(body).toMatchObject({ urlList: ["https://example.com/edited"] });
  });
});
