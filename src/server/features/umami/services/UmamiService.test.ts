import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UmamiService } from "./UmamiService";

const testDb = await vi.hoisted(async () => {
  const { createUmamiTestDb } = await import("../umami-test-db");
  return createUmamiTestDb();
});

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/server/lib/secretBox", () => ({
  sealSecret: async (value: string) => `sealed:${value}`,
  openSecret: async (value: string) => value.replace(/^sealed:/, ""),
}));

const fetchMock = vi.fn<typeof fetch>();
const connection = {
  projectId: "project_1",
  organizationId: "org_1",
  userId: "user_1",
};

function path(call: number) {
  const input = fetchMock.mock.calls[call]?.[0];
  return new URL(input instanceof Request ? input.url : String(input)).pathname;
}

async function storedConnections() {
  const result = await testDb.client.execute(
    "SELECT base_url, credential_hint, website_id FROM umami_connections",
  );
  return result.rows;
}

describe("UmamiService", () => {
  beforeEach(async () => {
    await testDb.client.execute("DELETE FROM umami_connections");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("doesn't store credentials Umami rejects", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    const result = await UmamiService.saveConnection({
      ...connection,
      credentials: { mode: "cloud", apiKey: "bad-key-0000" },
    });

    expect(result).toMatchObject({ ok: false, reason: "auth" });
    expect(await storedConnections()).toEqual([]);
  });

  it("refuses a self-hosted address on a private network before calling it", async () => {
    const result = await UmamiService.saveConnection({
      ...connection,
      baseUrl: "https://10.0.0.5",
      credentials: { mode: "self_hosted", username: "u", password: "p" },
    });

    expect(result).toMatchObject({ ok: false, reason: "blocked_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a plain-http instance address", async () => {
    const result = await UmamiService.saveConnection({
      ...connection,
      baseUrl: "http://umami.example.com",
      credentials: { mode: "self_hosted", username: "u", password: "p" },
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finds the project's website when only one of the user's teams can read it", async () => {
    await testDb.client.execute(
      `INSERT INTO umami_connections
        (id, project_id, organization_id, mode, base_url, credential_encrypted, credential_hint, connected_by_user_id)
       VALUES ('c1', 'project_1', 'org_1', 'cloud', 'https://api.umami.is/v1', 'sealed:{"apiKey":"key-1234"}', '1234', 'user_1')`,
    );
    fetchMock.mockImplementation(async (input) => {
      const { pathname } = new URL(
        input instanceof Request ? input.url : String(input),
      );
      if (pathname === "/v1/websites") {
        return Response.json({
          data: [{ id: "w-own", name: "Blog", domain: "blog.example.org" }],
          count: 1,
        });
      }
      if (pathname === "/v1/teams") {
        return Response.json({
          data: [{ id: "t1", name: "Agency" }],
          count: 1,
        });
      }
      return Response.json({
        data: [{ id: "w-team", name: "Shop", domain: "www.example.com" }],
        count: 1,
      });
    });

    const result = await UmamiService.listWebsites({
      projectId: "project_1",
      projectDomain: "example.com",
    });

    expect(result.websites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "w-team",
          teamId: "t1",
          teamName: "Agency",
          matchesProjectDomain: true,
        }),
        expect.objectContaining({ id: "w-own", matchesProjectDomain: false }),
      ]),
    );
    expect(path(2)).toBe("/v1/teams/t1/websites");
  });
});
