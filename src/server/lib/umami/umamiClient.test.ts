import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUmamiClient, UMAMI_CLOUD_API_URL } from "./umamiClient";

const fetchMock = vi.fn<typeof fetch>();

const WEBSITE = "7c1a6f3e-1111-4222-8333-944455556666";
const range = { websiteId: WEBSITE, startAt: 1, endAt: 2 };

function requestOf(call: number) {
  const [input, init] = fetchMock.mock.calls[call] ?? [];
  const url = new URL(input instanceof Request ? input.url : String(input));
  return { url, headers: new Headers(init?.headers) };
}

describe("umamiClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates Cloud calls with the API key header", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        pageviews: 30,
        visitors: 10,
        visits: 12,
        bounces: 6,
        totaltime: 600,
        comparison: {
          pageviews: 20,
          visitors: 8,
          visits: 9,
          bounces: 3,
          totaltime: 300,
        },
      }),
    );
    const client = createUmamiClient({
      baseUrl: UMAMI_CLOUD_API_URL,
      credentials: { mode: "cloud", apiKey: "api_key_1234" },
    });

    const stats = await client.getStats(range);

    expect(stats.previous).toMatchObject({ visitors: 8, visits: 9 });
    const { url, headers } = requestOf(0);
    expect(url.href).toBe(
      `https://api.umami.is/v1/websites/${WEBSITE}/stats?startAt=1&endAt=2`,
    );
    expect(headers.get("x-umami-api-key")).toBe("api_key_1234");
    expect(headers.get("authorization")).toBeNull();
  });

  it("logs in on a self-hosted instance and logs in again once when the token is refused", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ token: "token-1" }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ token: "token-2" }))
      .mockResolvedValueOnce(Response.json({ visitors: 3 }));
    const client = createUmamiClient({
      baseUrl: "https://umami.example.com/api",
      credentials: { mode: "self_hosted", username: "viewer", password: "pw" },
    });

    await expect(client.getActiveVisitors(WEBSITE)).resolves.toBe(3);

    const login = fetchMock.mock.calls[0]?.[1];
    expect(requestOf(0).url.pathname).toBe("/api/auth/login");
    expect(login?.body).toBe(
      JSON.stringify({ username: "viewer", password: "pw" }),
    );
    expect(requestOf(1).headers.get("authorization")).toBe("Bearer token-1");
    expect(requestOf(3).headers.get("authorization")).toBe("Bearer token-2");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reads Umami 2 stats, where each metric carries value and prev", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        pageviews: { value: 30, prev: 20 },
        visitors: { value: 10, prev: 8 },
        visits: { value: 12, prev: 9 },
        bounces: { value: "6", prev: "3" },
        totaltime: { value: 600, prev: 300 },
      }),
    );
    const client = createUmamiClient({
      baseUrl: UMAMI_CLOUD_API_URL,
      credentials: { mode: "cloud", apiKey: "api_key_1234" },
    });

    await expect(client.getStats(range)).resolves.toEqual({
      current: {
        pageviews: 30,
        visitors: 10,
        visits: 12,
        bounces: 6,
        totaltime: 600,
      },
      previous: {
        pageviews: 20,
        visitors: 8,
        visits: 9,
        bounces: 3,
        totaltime: 300,
      },
    });
  });

  it("asks an instance older than Umami 3 for pages as url instead of path", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValue(Response.json([{ x: "/pricing", y: 7 }]));
    const client = createUmamiClient({
      baseUrl: UMAMI_CLOUD_API_URL,
      credentials: { mode: "cloud", apiKey: "api_key_1234" },
    });

    const rows = await client.getMetrics({ ...range, type: "path", limit: 5 });

    expect(rows).toEqual([{ name: "/pricing", value: 7 }]);
    expect(requestOf(0).url.searchParams.get("type")).toBe("path");
    expect(requestOf(1).url.searchParams.get("type")).toBe("url");
  });
});
