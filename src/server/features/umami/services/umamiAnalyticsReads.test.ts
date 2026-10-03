import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UmamiConversionService } from "./UmamiConversionService";
import { UmamiInsightsService } from "./UmamiInsightsService";
import { UmamiOrganicLandingService } from "./UmamiOrganicLandingService";

const testDb = await vi.hoisted(async () => {
  const { createUmamiTestDb } = await import("../umami-test-db");
  return createUmamiTestDb();
});

const mocks = vi.hoisted(() => ({
  gscPerformance: vi.fn(),
  bingTable: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/server/lib/secretBox", () => ({
  openSecret: async (value: string) => value.replace(/^sealed:/, ""),
}));
vi.mock("@/server/features/gsc/services/GscService", async () => ({
  GscNotConnectedError: (await import("@/server/lib/gscErrors"))
    .GscNotConnectedError,
  isExpectedGrantFailure: () => false,
  GscService: { getPerformance: mocks.gscPerformance },
}));
vi.mock("@/server/features/bing/services/BingPerformanceService", () => ({
  BingPerformanceService: { table: mocks.bingTable },
}));

const fetchMock = vi.fn<typeof fetch>();
const range = {
  projectId: "project_1",
  startDate: "2026-09-01",
  endDate: "2026-09-28",
};

/** Answers Umami calls by path (and `type` for metrics); records POST
 *  bodies by path. */
function serveUmami(routes: Record<string, unknown>) {
  const posted: Record<string, unknown> = {};
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname
      .replace(/^\/v1\//, "")
      .replace(/^websites\/w1\//, "");
    const type = url.searchParams.get("type");
    if (typeof init?.body === "string") posted[path] = JSON.parse(init.body);
    const answer = routes[type ? `${path}?type=${type}` : path] ?? routes[path];
    return answer === undefined
      ? new Response(null, { status: 404 })
      : Response.json(answer);
  });
  return posted;
}

function referrerRow(name: string, visits: number) {
  return {
    name,
    pageviews: visits,
    visitors: visits,
    visits,
    bounces: 0,
    totaltime: 0,
  };
}

describe("Umami analytics page reads", () => {
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
    serveUmami({});
    mocks.gscPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      rows: [],
    });
    mocks.bingTable.mockResolvedValue({ connected: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("groups referrer hosts into search engines and leaves other Google services out", async () => {
    serveUmami({
      "metrics/expanded?type=referrer": [
        referrerRow("www.google.com", 5),
        referrerRow("google.es", 3),
        referrerRow("accounts.google.com", 9),
        referrerRow("cn.bing.com", 2),
        referrerRow("search.brave.com", 1),
      ],
    });

    const result = await UmamiInsightsService.getSearchEngines(range);

    expect(
      result.engines.map(({ engine, visits }) => ({ engine, visits })),
    ).toEqual([
      { engine: "google", visits: 8 },
      { engine: "bing", visits: 2 },
      { engine: "other", visits: 1 },
    ]);
  });

  it("joins organic landing pages with Search Console and Bing by path on the project's host", async () => {
    const entry = {
      name: "/guide/",
      pageviews: 9,
      visitors: 9,
      visits: 10,
      bounces: 10,
      totaltime: 0,
    };
    serveUmami({
      "metrics?type=referrer": [{ x: "www.google.com", y: 10 }],
      "metrics/expanded?type=entry": [entry],
      "metrics/expanded?type=path": [{ ...entry, bounces: 8, totaltime: 300 }],
    });
    mocks.gscPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      rows: [
        {
          keys: ["https://www.example.com/guide"],
          clicks: 0,
          impressions: 400,
          ctr: 0,
          position: 8,
        },
        {
          keys: ["https://blog.example.com/guide"],
          clicks: 50,
          impressions: 900,
          ctr: 0.05,
          position: 2,
        },
      ],
    });
    mocks.bingTable.mockResolvedValue({
      connected: true,
      rows: [
        {
          key: "http://example.com/guide/",
          clicks: 3,
          impressions: 30,
          ctr: 0.1,
          avgImpressionPosition: 4,
        },
      ],
    });

    const result = await UmamiOrganicLandingService.getOrganicLandings(range);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      path: "/guide",
      visits: 10,
      bounceRate: 0.8,
      google: { clicks: 0, impressions: 400 },
      bing: { clicks: 3, position: 4 },
      highImpressionsPoorRetention: true,
      visitsWithoutGscClicks: true,
    });
  });

  it("runs a saved funnel with its own steps and window", async () => {
    const steps = [
      { type: "path", value: "/" },
      { type: "event", value: "signup" },
    ];
    const posted = serveUmami({
      reports: {
        data: [
          {
            id: "r1",
            name: "Onboarding",
            type: "funnel",
            parameters: { steps, window: 30 },
          },
        ],
      },
      "reports/funnel": [
        { type: "path", value: "/", visitors: 100, previous: 0, dropoff: null },
        { type: "event", value: "signup", visitors: "40" },
      ],
    });

    const result = await UmamiConversionService.runFunnel({
      ...range,
      channel: "all",
      reportId: "r1",
      windowMinutes: 60,
    });

    expect(posted["reports/funnel"]).toMatchObject({
      type: "funnel",
      filters: { hostname: "eq.example.com,www.example.com" },
      parameters: { steps, window: 30 },
    });
    expect(result.savedName).toBe("Onboarding");
    expect(result.steps[1]).toMatchObject({
      visitors: 40,
      dropped: 60,
      remainingRate: 0.4,
    });
  });

  it("reports no Web Vitals data when the site sends none", async () => {
    serveUmami({
      "reports/performance": {
        summary: { lcp: { p50: 0, p75: 0, p95: 0 }, count: 0 },
        pages: [{ name: "/", p50: 0, p75: 0, p95: 0, count: 0 }],
      },
    });

    const result = await UmamiConversionService.getWebVitals({
      ...range,
      channel: "all",
    });

    expect(result).toMatchObject({
      available: true,
      hasData: false,
      pages: [],
    });
    expect(result.metrics.every((metric) => metric.rating === null)).toBe(true);
  });

  it("keeps an event's properties to ten, each with its ten most frequent values", async () => {
    const rows = Array.from({ length: 12 }, (_row, property) =>
      Array.from({ length: property === 0 ? 15 : 1 }, (_column, value) => ({
        eventName: "test_completed",
        propertyName: `p${property}`,
        propertyValue: `v${value}`,
        total: 100 - property - value,
      })),
    ).flat();
    serveUmami({ "event-data/events": rows, "events/series": [] });

    const result = await UmamiConversionService.getEventDetail({
      ...range,
      channel: "all",
      event: "test_completed",
    });

    expect(result.properties).toHaveLength(10);
    expect(result.moreProperties).toBe(2);
    expect(result.properties[0]).toMatchObject({ name: "p0", moreValues: 5 });
    expect(result.properties[0]?.values).toHaveLength(10);
  });

  it("reads UTM fields from Umami's UTM report and campaign combinations from landing query strings", async () => {
    const posted = serveUmami({
      "reports/utm": {
        utm_source: [{ utm: "chatgpt.com", views: "958" }],
        utm_medium: [{ utm: "paid", views: 928 }],
      },
      "metrics?type=query": [
        { x: "utm_source=app&utm_medium=sidebar_card", y: 99 },
        { x: "utm_medium=sidebar_card&utm_source=app&fbclid=1", y: 1 },
        { x: "page=2", y: 50 },
      ],
    });

    const result = await UmamiInsightsService.getCampaigns(range);

    expect(posted["reports/utm"]).toMatchObject({
      filters: { hostname: "eq.example.com,www.example.com" },
    });
    expect(
      result.fields.find((field) => field.field === "utm_source")?.rows,
    ).toEqual([{ value: "chatgpt.com", views: 958 }]);
    expect(result.combinations).toEqual([
      {
        source: "app",
        medium: "sidebar_card",
        campaign: null,
        content: null,
        term: null,
        count: 100,
      },
    ]);
  });

  it("counts AI assistant visits by referrer host and by utm_source", async () => {
    serveUmami({
      "metrics/expanded?type=referrer": [
        {
          name: "chatgpt.com",
          pageviews: 4,
          visitors: 3,
          visits: 4,
          bounces: 2,
          totaltime: 0,
        },
        {
          name: "www.perplexity.ai",
          pageviews: 1,
          visitors: 1,
          visits: 1,
          bounces: 1,
          totaltime: 0,
        },
        {
          name: "news.ycombinator.com",
          pageviews: 9,
          visitors: 9,
          visits: 9,
          bounces: 0,
          totaltime: 0,
        },
      ],
      "reports/utm": {
        utm_source: [
          { utm: "chatgpt.com", views: 958 },
          { utm: "chatgpt", views: 928 },
          { utm: "meta", views: 587 },
        ],
      },
      pageviews: { pageviews: [], sessions: [] },
      "metrics?type=entry": [],
    });

    const result = await UmamiInsightsService.getAiReferrals(range);

    expect(
      result.assistants.map(({ assistant, referredVisits, taggedViews }) => ({
        assistant,
        referredVisits,
        taggedViews,
      })),
    ).toEqual([
      { assistant: "chatgpt", referredVisits: 4, taggedViews: 1886 },
      { assistant: "perplexity", referredVisits: 1, taggedViews: 0 },
    ]);
  });
});
