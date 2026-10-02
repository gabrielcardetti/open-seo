import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BingApiError, createBingClient } from "./bingClient";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const client = createBingClient("key_123");

describe("bingClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the key and site, and renders Bing's day buckets in UTC", async () => {
    // 2026-09-26T07:00:00Z: a Pacific-midnight bucket that would read as the
    // 25th if formatted in a US timezone.
    fetchMock.mockResolvedValue(
      jsonResponse({
        d: [
          {
            __type: "RankAndTrafficStats:#Microsoft.Bing.Webmaster.Api",
            Date: "/Date(1790406000000-0700)/",
            Clicks: 4,
            Impressions: 90,
          },
        ],
      }),
    );

    const rows = await client.getRankAndTrafficStats("https://example.com/");

    expect(rows).toEqual([{ date: "2026-09-26", clicks: 4, impressions: 90 }]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/webmaster/api.svc/json/GetRankAndTrafficStats");
    expect(url.searchParams.get("apikey")).toBe("key_123");
    expect(url.searchParams.get("siteUrl")).toBe("https://example.com/");
  });

  it("reads page rows whether Bing names the URL Page or Query, and drops empty positions", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        d: [
          {
            Date: "/Date(1790406000000)/",
            Query: "https://example.com/a",
            Clicks: 0,
            Impressions: 12,
            AvgClickPosition: -1,
            AvgImpressionPosition: 7.5,
          },
          {
            Date: "/Date(1790406000000)/",
            Page: "https://example.com/b",
            Clicks: 1,
            Impressions: 3,
            AvgClickPosition: 2,
            AvgImpressionPosition: 2.4,
          },
        ],
      }),
    );

    const rows = await client.getPageStats("https://example.com/");

    expect(rows.map((row) => row.page)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(rows[0].avgClickPosition).toBeNull();
    expect(rows[0].avgImpressionPosition).toBe(7.5);
  });

  it("treats d: null as no data", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ d: null }));

    await expect(
      client.getCrawlIssues("https://example.com/"),
    ).resolves.toEqual([]);
  });

  it("rejects a 200 without the d envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [] }));

    await expect(client.getUserSites()).rejects.toMatchObject({
      kind: "other",
    });
  });

  it("classifies an invalid key reported as a 400 with ErrorCode 3", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ErrorCode: 3, Message: "InvalidApiKey" }, 400),
    );

    const error = await client.getUserSites().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BingApiError);
    expect(error).toMatchObject({ kind: "auth", errorCode: 3 });
  });

  it("classifies a site the account can't read as site_access", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ErrorCode: 14, Message: "NotAuthorized" }, 400),
    );

    await expect(
      client.getQueryStats("https://other.com/"),
    ).rejects.toMatchObject({ kind: "site_access" });
  });

  it("posts URL batches as a wrapped JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ d: null }));

    await client.submitUrlBatch("https://example.com/", [
      "https://example.com/a",
    ]);

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      siteUrl: "https://example.com/",
      urlList: ["https://example.com/a"],
    });
  });
});
