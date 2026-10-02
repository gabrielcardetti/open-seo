import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleDeployHookRequest } from "./deployHook";
import { IndexingService } from "./IndexingService";
import { resetTestDatabase } from "./indexing-test-db";

const mocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));

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

const hookRequest = (secret: string) =>
  new Request("https://openseo.test/api/indexing/hook/x", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ urls: ["https://example.com/a"] }),
  });

describe("deploy hook", () => {
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
  });

  it("accepts only the project's current secret, with one answer for wrong secrets and unknown projects", async () => {
    const { secret } =
      await IndexingService.rotateDeployHookSecret("project-1");

    const accepted = await handleDeployHookRequest(
      hookRequest(secret),
      "project-1",
    );
    const wrongSecret = await handleDeployHookRequest(
      hookRequest(`${secret}x`),
      "project-1",
    );
    const unknownProject = await handleDeployHookRequest(
      hookRequest(secret),
      "project-2",
    );

    expect(accepted.status).toBe(200);
    expect(wrongSecret.status).toBe(401);
    expect(unknownProject.status).toBe(401);
    expect(await unknownProject.json()).toEqual(await wrongSecret.json());
  });

  it("sends nothing for an archived project and says why", async () => {
    const { secret } =
      await IndexingService.rotateDeployHookSecret("project-1");
    // Archived projects are not found by id.
    mocks.getProjectById.mockResolvedValue(null);

    const response = await handleDeployHookRequest(
      hookRequest(secret),
      "project-1",
    );

    const body = z
      .object({ ok: z.boolean(), problem: z.string() })
      .parse(await response.json());
    expect(body.ok).toBe(false);
    expect(body.problem).toContain("archived");
    expect(fetch).not.toHaveBeenCalled();
  });
});
