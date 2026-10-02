import { beforeEach, describe, expect, it, vi } from "vitest";
import { BingApiError } from "@/server/lib/bing/bingErrors";
import { resetBingTestDb } from "@/server/features/bing/bing-test-db";
import { BingService } from "./BingService";

const testDb = await vi.hoisted(async () => {
  const { createBingTestDb } = await import("../bing-test-db");
  return createBingTestDb();
});

const getUserSites = vi.hoisted(() => vi.fn());

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/server/lib/secretBox", () => ({
  sealSecret: async (value: string) => `sealed:${value}`,
  openSecret: async (value: string) => value.replace(/^sealed:/, ""),
}));
vi.mock("@/server/lib/bing/bingClient", () => ({
  createBingClient: () => ({ getUserSites }),
}));

async function storedKey() {
  const result = await testDb.client.execute(
    "SELECT api_key_encrypted, key_hint FROM bing_api_keys WHERE user_id = 'user_1'",
  );
  return result.rows[0] ?? null;
}

describe("BingService.saveApiKey", () => {
  beforeEach(async () => {
    await resetBingTestDb(testDb.client);
    getUserSites.mockResolvedValue([
      { url: "https://example.com/", isVerified: true },
      { url: "https://other.example/", isVerified: false },
    ]);
  });

  it("doesn't store a key Bing rejects", async () => {
    getUserSites.mockRejectedValue(
      new BingApiError("auth", "Bing rejected the API key.", 400, 3),
    );

    const result = await BingService.saveApiKey("user_1", "bad-key-0000");

    expect(result).toMatchObject({ ok: false, reason: "invalid_key" });
    expect(await storedKey()).toBeNull();
  });

  it("replaces a saved key, including one Bing has revoked", async () => {
    await testDb.client.execute(
      "INSERT INTO bing_api_keys (user_id, api_key_encrypted, key_hint) VALUES ('user_1', 'sealed:revoked-1111', '1111')",
    );

    const result = await BingService.saveApiKey("user_1", " new-key-2222 ");

    expect(result).toEqual({ ok: true, keyHint: "2222", verifiedSiteCount: 1 });
    expect(await storedKey()).toEqual({
      api_key_encrypted: "sealed:new-key-2222",
      key_hint: "2222",
    });
  });
});

describe("BingService.listSites", () => {
  beforeEach(async () => {
    await resetBingTestDb(testDb.client);
    await testDb.client.execute(
      "INSERT INTO bing_api_keys (user_id, api_key_encrypted, key_hint) VALUES ('user_1', 'sealed:key-1111', '1111')",
    );
    getUserSites.mockResolvedValue([
      { url: "https://www.Example.com/", isVerified: true },
      { url: "https://blog.example.com/", isVerified: true },
      { url: "https://unverified.example/", isVerified: false },
    ]);
  });

  it("offers verified sites only, verbatim, flagging the project's domain", async () => {
    const result = await BingService.listSites({
      userId: "user_1",
      projectId: "proj_1",
      projectDomain: "example.com",
    });

    expect(result.sites).toEqual([
      {
        siteUrl: "https://www.Example.com/",
        matchesProjectDomain: true,
        isSelected: false,
      },
      {
        siteUrl: "https://blog.example.com/",
        matchesProjectDomain: false,
        isSelected: false,
      },
    ]);
  });
});
