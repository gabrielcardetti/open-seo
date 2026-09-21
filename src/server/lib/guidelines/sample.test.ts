import { describe, expect, it } from "vitest";
import {
  selectGuidelinesSample,
  templateInventory,
  type GuidelinesSamplePage,
} from "./sample";

function page(
  url: string,
  overrides: Partial<GuidelinesSamplePage> = {},
): GuidelinesSamplePage {
  return {
    id: `id:${url}`,
    url,
    statusCode: 200,
    isIndexable: true,
    fetchClass: "ok",
    wordCount: 500,
    contentHash: null,
    crawlDepth: 1,
    ...overrides,
  };
}

const START = "https://example.com/";

describe("selectGuidelinesSample", () => {
  it("selects nothing when the strategy is off", () => {
    expect(selectGuidelinesSample([page(START)], START, "none")).toEqual([]);
  });

  it("always includes the start URL", () => {
    const sample = selectGuidelinesSample(
      [page("https://example.com/a-long-slug-here"), page(START)],
      START,
      "sample",
    );
    expect(sample[0]?.url).toBe(START);
  });

  // A noindex or errored page is not competing in Search, so the content
  // guidelines have nothing to say about it and a judge call on it is wasted.
  it("skips pages that are not eligible to be judged", () => {
    const pages = [
      page("https://example.com/ok-page-one"),
      page("https://example.com/noindexed", { isIndexable: false }),
      page("https://example.com/missing", { statusCode: 404 }),
      page("https://example.com/blocked", { fetchClass: "blocked" }),
      page("https://example.com/never-fetched", { statusCode: null }),
    ];
    const urls = selectGuidelinesSample(pages, START, "sample").map(
      (s) => s.url,
    );
    expect(urls).toEqual(["https://example.com/ok-page-one"]);
  });

  // 40 near-identical pages must not eat the whole budget: one example of the
  // template, plus a bounded couple more in case they disagree.
  it("does not spend the budget re-judging one template", () => {
    const pages = Array.from({ length: 40 }, (_, i) =>
      page(`https://example.com/tests/especialidad-numero-${i}`),
    );
    expect(selectGuidelinesSample(pages, START, "sample")).toHaveLength(3);
  });

  it("covers every template before adding a second example of any", () => {
    const pages = [
      ...Array.from({ length: 20 }, (_, i) =>
        page(`https://example.com/tests/especialidad-numero-${i}`),
      ),
      page("https://example.com/guias/una-guia-cualquiera"),
    ];
    const urls = selectGuidelinesSample(pages, START, "sample", 2).map(
      (s) => s.url,
    );
    expect(urls).toContain("https://example.com/guias/una-guia-cualquiera");
  });

  it("picks the fullest example of each template", () => {
    const pages = [
      page("https://example.com/guias/una-guia-cualquiera", { wordCount: 50 }),
      page("https://example.com/guias/otra-guia-distinta", { wordCount: 3000 }),
    ];
    const sample = selectGuidelinesSample(pages, START, "sample");
    expect(sample[0]?.url).toBe("https://example.com/guias/otra-guia-distinta");
  });

  it("gives identical content a single verdict", () => {
    const pages = [
      page("https://example.com/one", { contentHash: "same" }),
      page("https://example.com/two", { contentHash: "same" }),
      page("https://example.com/three", { contentHash: "different" }),
    ];
    expect(selectGuidelinesSample(pages, START, "sample")).toHaveLength(2);
  });

  it("respects the cap", () => {
    const pages = Array.from({ length: 50 }, (_, i) =>
      page(`https://example.com/section${i}/page`),
    );
    expect(selectGuidelinesSample(pages, START, "sample", 5)).toHaveLength(5);
  });

  it("fills leftover budget on a small site", () => {
    const pages = [
      page("https://example.com/tests/uno-dos-tres", { wordCount: 100 }),
      page("https://example.com/tests/cuatro-cinco-seis", { wordCount: 200 }),
      page("https://example.com/tests/siete-ocho-nueve", { wordCount: 300 }),
    ];
    // One template, but budget to spare: take a bounded few rather than one.
    expect(selectGuidelinesSample(pages, START, "sample", 10)).toHaveLength(3);
  });

  it("takes every eligible page under the 'all' strategy", () => {
    const pages = [
      page("https://example.com/a-page-here"),
      page("https://example.com/b-page-here"),
      page("https://example.com/hidden", { isIndexable: false }),
    ];
    expect(selectGuidelinesSample(pages, START, "all")).toHaveLength(2);
  });

  it("ignores a page whose URL cannot be parsed", () => {
    const pages = [
      page("not a url"),
      page("https://example.com/real-page-here"),
    ];
    const urls = selectGuidelinesSample(pages, START, "sample").map(
      (s) => s.url,
    );
    expect(urls).toEqual(["https://example.com/real-page-here"]);
  });
});

describe("templateInventory", () => {
  // The signal page-level judging structurally cannot see: one doorway looks
  // ordinary, two hundred siblings do not.
  it("counts URLs per template, largest group first", () => {
    const pages = [
      ...Array.from({ length: 128 }, (_, i) =>
        page(`https://example.com/canarias/tests/especialidad-${i}-x`),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        page(`https://example.com/guias/una-guia-numero-${i}`),
      ),
      page("https://example.com/"),
    ];
    const inventory = templateInventory(pages);
    expect(inventory[0]).toMatchObject({ count: 128 });
    expect(inventory[0]?.examples).toHaveLength(3);
    expect(inventory[1]).toMatchObject({ count: 5 });
  });
});
