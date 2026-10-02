import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BingConnectionRepository } from "@/server/features/bing/repositories/BingConnectionRepository";
import { IndexingRepository } from "./IndexingRepository";
import { testDb, resetTestDatabase } from "./indexing-test-db";
import { UrlSubmissionService } from "./UrlSubmissionService";
import { bingConnections } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  openBingClientForProject: vi.fn(),
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
vi.mock("@/server/features/bing/bingAccess", () => ({
  openBingClientForProject: mocks.openBingClientForProject,
}));

/** The JSON bodies POSTed to IndexNow. */
const indexNowBodies = (): unknown[] =>
  vi
    .mocked(fetch)
    .mock.calls.map(([, init]): unknown =>
      JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
    );

async function verifiedIndexNowKey() {
  await IndexingRepository.upsertSettings("project-1", {
    indexnowKey: "a1b2c3d4e5f6a7b8",
    indexnowVerifiedAt: "2026-10-01T00:00:00.000Z",
  });
}

describe("UrlSubmissionService.submitUrls", () => {
  beforeEach(() => {
    resetTestDatabase();
    mocks.getProjectById.mockResolvedValue({
      id: "project-1",
      domain: "example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("retries a throttled IndexNow request and records the final answer", async () => {
    await verifiedIndexNowKey();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 }));

    const result = await UrlSubmissionService.submitUrls(
      "project-1",
      ["https://example.com/a"],
      "manual",
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      expect.objectContaining({ status: "received", channel: "indexnow" }),
    ]);
  });

  it("sends IndexNow requests through a configured relay with its secret", async () => {
    await verifiedIndexNowKey();
    vi.stubEnv("INDEXNOW_API_BASE_URL", "https://relay.example.com/");
    vi.stubEnv("INDEXNOW_RELAY_SECRET", "relay-secret");

    await UrlSubmissionService.submitUrls(
      "project-1",
      ["https://example.com/a"],
      "manual",
    );

    const [input, init] = vi.mocked(fetch).mock.calls[0];
    expect(input).toBe("https://relay.example.com/indexnow");
    expect(init?.headers).toMatchObject({ "X-Relay-Secret": "relay-secret" });
  });

  it("records a 403 as rejected and stops treating the key as verified", async () => {
    await verifiedIndexNowKey();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }));

    const result = await UrlSubmissionService.submitUrls(
      "project-1",
      ["https://example.com/a"],
      "manual",
    );

    expect(result.results[0]).toMatchObject({
      status: "rejected",
      httpStatus: 403,
    });
    expect(result.results[0]?.errorMessage).toContain("key file");
    const settings = await IndexingRepository.getSettings("project-1");
    expect(settings?.indexnowVerifiedAt).toBeNull();
  });

  it("skips URLs announced within the dedupe window unless forced", async () => {
    await verifiedIndexNowKey();
    const submit = (force?: boolean) =>
      UrlSubmissionService.submitUrls(
        "project-1",
        ["https://example.com/a"],
        "manual",
        { force },
      );

    await submit();
    const repeated = await submit();
    const forced = await submit(true);

    expect(repeated.results[0]?.status).toBe("skipped_duplicate");
    expect(forced.results[0]?.status).toBe("received");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends www and apex URLs as separate IndexNow hosts and drops other sites", async () => {
    await verifiedIndexNowKey();

    const result = await UrlSubmissionService.submitUrls(
      "project-1",
      [
        "https://www.example.com/a",
        "https://example.com/b",
        "https://other.com/c",
      ],
      "manual",
    );

    expect(indexNowBodies()).toEqual([
      expect.objectContaining({
        host: "www.example.com",
        urlList: ["https://www.example.com/a"],
      }),
      expect.objectContaining({
        host: "example.com",
        urlList: ["https://example.com/b"],
      }),
    ]);
    expect(result.dropped.map((entry) => entry.url)).toEqual([
      "https://other.com/c",
    ]);
  });

  it("sends to Bing only as many URLs as the daily quota allows", async () => {
    await testDb.insert(bingConnections).values({
      id: "connection-1",
      projectId: "project-1",
      organizationId: "org-1",
      siteUrl: "https://example.com/",
      connectedByUserId: "user-1",
    });
    const submitUrlBatch = vi.fn().mockResolvedValue(undefined);
    mocks.openBingClientForProject.mockResolvedValue({
      connection: { siteUrl: "https://example.com/" },
      client: {
        getUrlSubmissionQuota: () =>
          Promise.resolve({ daily: 1, monthly: 100 }),
        submitUrlBatch,
      },
    });

    const result = await UrlSubmissionService.submitUrls(
      "project-1",
      ["https://example.com/a", "https://example.com/b"],
      "manual",
    );

    expect(result.results.map((row) => row.status)).toEqual([
      "received",
      "skipped_quota",
    ]);
    expect(submitUrlBatch).toHaveBeenCalledWith("https://example.com/", [
      "https://example.com/a",
    ]);
    const connection =
      await BingConnectionRepository.getByProjectId("project-1");
    expect(connection?.dailyQuotaRemaining).toBe(0);
  });
});
