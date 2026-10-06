import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreWebVitalsService } from "./CoreWebVitalsService";

vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: (prefix: string, params: unknown) =>
    Promise.resolve(`${prefix}:${JSON.stringify(params)}`),
  getCached: () => Promise.resolve(null),
  setCached: () => Promise.resolve(),
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: () => Promise.resolve("test-key"),
}));

const fetchMock = vi.fn<typeof fetch>();
const period = (day: number) => ({
  firstDate: { year: 2026, month: 9, day },
  lastDate: { year: 2026, month: 10, day },
});

describe("CoreWebVitalsService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back from a page without CrUX data to its origin, with history", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          record: {
            metrics: {
              largest_contentful_paint: {
                histogram: [{ start: 0, density: 0.8 }],
                percentiles: { p75: 2100 },
              },
              cumulative_layout_shift: { percentiles: { p75: "0.30" } },
              experimental_time_to_first_byte: { percentiles: { p75: 900 } },
            },
            collectionPeriod: period(4),
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          record: {
            metrics: {
              cumulative_layout_shift: {
                percentilesTimeseries: { p75s: ["0.05", null] },
              },
            },
            collectionPeriods: [period(1), period(2)],
          },
        }),
      );

    const result = await CoreWebVitalsService.getFieldData({
      url: "https://example.com/page",
      formFactor: "PHONE",
      includeHistory: true,
    });

    expect(result).toMatchObject({
      found: true,
      scope: "origin",
      target: "https://example.com",
      assessment: "failed",
      history: [
        { endDate: "2026-10-01", cls: 0.05 },
        { endDate: "2026-10-02", cls: null },
      ],
    });
    expect(result.found && result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "cls", p75: 0.3, rating: "poor" }),
        expect.objectContaining({ metric: "ttfb", p75: 900 }),
        expect.objectContaining({ metric: "lcp", good: 0.8 }),
      ]),
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("test-key");
  });

  it("reads PageSpeed field CLS as a score x100 and skips origin-fallback page data", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        loadingExperience: {
          origin_fallback: true,
          metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 99 } },
        },
        originLoadingExperience: {
          metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } },
        },
        lighthouseResult: { categories: { performance: { score: 0.42 } } },
      }),
    );

    const result = await CoreWebVitalsService.runPagespeed({
      url: "https://example.com/",
      strategy: "mobile",
    });

    expect(result.scores.performance).toBe(42);
    expect(result.field?.scope).toBe("origin");
    expect(result.field?.metrics.find((m) => m.metric === "cls")).toMatchObject(
      { p75: 0.05, rating: "good" },
    );
  });
});
