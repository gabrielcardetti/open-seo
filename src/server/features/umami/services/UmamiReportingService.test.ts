import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UmamiReportingService } from "./UmamiReportingService";

const testDb = await vi.hoisted(async () => {
  const { createUmamiTestDb } = await import("../umami-test-db");
  return createUmamiTestDb();
});

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/server/lib/secretBox", () => ({
  openSecret: async (value: string) => value.replace(/^sealed:/, ""),
}));

const fetchMock = vi.fn<typeof fetch>();

function requestUrl(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : String(input));
}

describe("UmamiReportingService organic reads", () => {
  beforeEach(async () => {
    await testDb.client.execute("DELETE FROM umami_connections");
    await testDb.client.execute("DELETE FROM projects");
    await testDb.client.execute(
      "INSERT INTO projects (id, domain) VALUES ('project_1', 'example.com')",
    );
    await testDb.client.execute(
      `INSERT INTO umami_connections
        (id, project_id, organization_id, mode, base_url, credential_encrypted, credential_hint, website_id, connected_by_user_id)
       VALUES ('c1', 'project_1', 'org_1', 'cloud', 'https://api.umami.is/v1', 'sealed:{"apiKey":"key-1234"}', '1234', 'w1', 'user_1')`,
    );
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.searchParams.get("type") === "referrer") {
        return Response.json([
          { x: "www.google.com", y: 5 },
          { x: "news.ycombinator.com", y: 3 },
          { x: "mail.google.com", y: 1 },
          { x: "duckduckgo.com", y: 2 },
        ]);
      }
      if (url.pathname.endsWith("/pageviews")) {
        return Response.json({ pageviews: [], sessions: [] });
      }
      return Response.json({
        pageviews: 9,
        visitors: 4,
        visits: 5,
        bounces: 1,
        totaltime: 100,
        comparison: {
          pageviews: 0,
          visitors: 0,
          visits: 0,
          bounces: 0,
          totaltime: 0,
        },
      });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats visits referred by search engine domains as organic", async () => {
    const result = await UmamiReportingService.getOverview({
      projectId: "project_1",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      channel: "organic_search",
    });

    expect(result.organicDetection?.referrerDomains).toEqual([
      "www.google.com",
      "duckduckgo.com",
    ]);
    const statsCall = fetchMock.mock.calls
      .map(([input]) => requestUrl(input))
      .find((url) => url.pathname.endsWith("/stats"));
    expect(statsCall?.searchParams.get("referrer")).toBe(
      "eq.www.google.com,duckduckgo.com",
    );
    // One Umami website can track several hostnames; reads keep to the
    // project's site.
    expect(statsCall?.searchParams.get("hostname")).toBe(
      "eq.example.com,www.example.com",
    );
    expect(result.current).toMatchObject({ visitors: 4, bounceRate: 0.2 });
  });
});
