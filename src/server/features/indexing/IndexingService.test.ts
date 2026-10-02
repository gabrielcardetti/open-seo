import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexingRepository } from "./IndexingRepository";
import { IndexingService } from "./IndexingService";
import { resetTestDatabase } from "./indexing-test-db";
import type * as UrlPolicy from "@/server/lib/audit/url-policy";

const KEY = "a1b2c3d4e5f6a7b8";
const mocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => ({
  db: (await import("./indexing-test-db")).testDb,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: mocks.getProjectById },
}));
// No DNS lookups in tests; the hostname screen still applies.
vi.mock("@/server/lib/audit/url-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof UrlPolicy>()),
  normalizeAndValidateStartUrl: (url: string) => Promise.resolve(url),
}));

const redirectTo = (location: string) =>
  new Response(null, { status: 301, headers: { location } });

describe("IndexingService.verifyKey", () => {
  beforeEach(async () => {
    resetTestDatabase();
    mocks.getProjectById.mockResolvedValue({
      id: "project-1",
      domain: "example.com",
    });
    vi.stubGlobal("fetch", vi.fn());
    await IndexingRepository.upsertSettings("project-1", { indexnowKey: KEY });
  });

  it("does not follow a key file redirect to another site", async () => {
    vi.mocked(fetch).mockResolvedValue(
      redirectTo("https://elsewhere.test/key.txt"),
    );

    const result = await IndexingService.verifyKey("project-1");

    expect(result.verified).toBe(false);
    expect(result.error).toContain("redirects");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reads the key file on the site's www host when the apex redirects there", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(redirectTo(`https://www.example.com/${KEY}.txt`))
      .mockResolvedValueOnce(new Response(KEY, { status: 200 }));

    const result = await IndexingService.verifyKey("project-1");

    expect(result.verified).toBe(true);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      `https://example.com/${KEY}.txt`,
      `https://www.example.com/${KEY}.txt`,
    ]);
  });
});
