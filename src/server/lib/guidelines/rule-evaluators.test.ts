import { describe, expect, it } from "vitest";
import { GUIDELINE_RULES } from "@/shared/guidelines/catalog";
import { evaluateDeterministic } from "./rule-evaluators";
import type { FetchedPage } from "./page-fetch";
import { emptySpamSignals } from "./spam-signals";
import { buildSiteFacts } from "./site-facts";
import { fetchedPageFixture } from "./guideline-test-support";

function fetchedPage(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return fetchedPageFixture({ title: "A", bodyText: "Texto.", ...overrides });
}

const status = (ruleId: string, page: Partial<FetchedPage>) =>
  evaluateDeterministic(ruleId, { page: fetchedPage(page) })?.status;

describe("evaluateDeterministic", () => {
  // A binary rule with no evaluator is excluded from the judges and has
  // nothing else to answer it, so it would sit at `unknown` on every page.
  it("has an evaluator for every binary rule", () => {
    const unanswered = GUIDELINE_RULES.filter(
      (rule) =>
        rule.check === "binary" &&
        evaluateDeterministic(rule.id, { page: fetchedPage() }) === null,
    ).map((rule) => rule.id);
    expect(unanswered).toEqual([]);
  });

  it("reads noindex from every place Google does", () => {
    expect(status("TECH-04", {})).toBe("pass");
    expect(status("TECH-04", { robotsMeta: "noindex, follow" })).toBe("fail");
    // `none` is noindex + nofollow.
    expect(status("TECH-04", { robotsMeta: "none" })).toBe("fail");
    expect(status("TECH-04", { googlebotMeta: "noindex" })).toBe("fail");
    expect(status("TECH-04", { robotsHeader: "noindex" })).toBe("fail");
    expect(status("TECH-04", { robotsHeader: "googlebot: noindex" })).toBe(
      "fail",
    );
  });

  // `max-image-preview:none` is a snippet setting on indexable pages.
  it("does not read a preview setting of none as noindex", () => {
    expect(
      status("TECH-04", {
        robotsMeta: "index, follow, max-image-preview:none",
      }),
    ).toBe("pass");
  });

  it("ignores an X-Robots-Tag noindex aimed at another crawler", () => {
    expect(status("TECH-04", { robotsHeader: "otherbot: noindex" })).toBe(
      "pass",
    );
    expect(
      status("TECH-04", {
        robotsHeader: "otherbot: noindex, googlebot: nofollow",
      }),
    ).toBe("pass");
  });

  it("settles a self or absent canonical and leaves a foreign one open", () => {
    expect(status("TECH-05", {})).toBe("pass");
    expect(status("TECH-05", { canonical: "https://example.com/a/" })).toBe(
      "pass",
    );
    expect(status("TECH-05", { canonical: "https://example.com/b" })).toBe(
      "unknown",
    );
  });

  // A raw fetch cannot clear a page of spam, so an empty scan must leave the
  // rule to its reviewer rather than settle it.
  it("warns on a spam signal and otherwise leaves the rule unsettled", () => {
    const spamSignals = {
      ...emptySpamSignals(),
      sneakyRedirects: [
        "Meta refresh after 0s to another site: https://x.org/",
      ],
    };
    expect(
      evaluateDeterministic("SPAM-13", { page: fetchedPage({ spamSignals }) }),
    ).toMatchObject({
      status: "warn",
      evidence: spamSignals.sneakyRedirects[0],
    });
    expect(
      evaluateDeterministic("SPAM-13", { page: fetchedPage() }),
    ).toBeNull();
  });

  it("flags a machine byline but not a person who shares its name", () => {
    const byline = (author: string) =>
      status("EAT-05", {
        structuredData: [{ "@type": "Article", author: { name: author } }],
      });
    expect(byline("ChatGPT")).toBe("fail");
    expect(byline("AI Writer")).toBe("fail");
    expect(byline("Claude Monet")).toBe("pass");
    expect(byline("Ai Weiwei")).toBe("pass");
  });
});

describe("Bing evaluators", () => {
  // NOARCHIVE removes the page from Copilot; NOCACHE, which wins when both
  // are set, only trims the citation.
  it("reads noarchive and nocache from every place Bing does", () => {
    expect(status("BING-08", {})).toBe("pass");
    expect(status("BING-08", { robotsMeta: "noarchive" })).toBe("fail");
    expect(status("BING-08", { bingbotMeta: "noarchive" })).toBe("fail");
    expect(status("BING-08", { robotsHeader: "bingbot: noarchive" })).toBe(
      "fail",
    );
    expect(status("BING-08", { robotsHeader: "googlebot: noarchive" })).toBe(
      "pass",
    );
    expect(status("BING-08", { robotsMeta: "noarchive, nocache" })).toBe(
      "warn",
    );
  });

  it("fails nosnippet and only warns on data-nosnippet", () => {
    expect(status("BING-09", { robotsMeta: "max-snippet:0" })).toBe("fail");
    expect(status("BING-09", { dataNosnippet: 2 })).toBe("warn");
    expect(status("BING-09", { robotsMeta: "max-snippet:200" })).toBe("pass");
  });

  it("fails a short not-found page served with 200, not an article about 404s", () => {
    expect(
      status("BING-07", {
        title: "Página no encontrada | Tienda",
        wordCount: 40,
      }),
    ).toBe("fail");
    // An article about the error is titled after it, not as it.
    expect(
      status("BING-07", {
        title: "Error 404: qué es y cómo solucionarlo",
        wordCount: 250,
      }),
    ).toBe("pass");
    // A not-found title on a long page is a lead, not a verdict.
    expect(status("BING-07", { title: "Page not found", wordCount: 900 })).toBe(
      "unknown",
    );
  });

  it("fails a missing meta description and warns on a short one", () => {
    expect(status("BING-13", { title: "Guía de riego por goteo" })).toBe(
      "fail",
    );
    expect(
      status("BING-13", {
        title: "Guía de riego por goteo",
        metaDescription: "Riego por goteo.",
      }),
    ).toBe("warn");
  });

  // The site pass draws the repeat lists for the sampled pages only; a page
  // judged later (a flagged cluster's member) was never compared.
  it("leaves BING-13 open on a page the repeat check did not cover", () => {
    const crawled = ["/a", "/b", "/c"].map((path) => ({
      id: path,
      url: `https://example.com${path}`,
      statusCode: 200,
      isIndexable: true,
      title: "Riego por goteo",
      wordCount: 500,
      contentHash: path,
      crawlDepth: 1,
    }));
    const site = {
      facts: buildSiteFacts({
        pages: crawled,
        startUrl: "https://example.com/",
        crawlCompleted: true,
        memberUrlFilter: new Set(["https://example.com/a"]),
      }),
    };
    const bing13 = (url: string) =>
      evaluateDeterministic("BING-13", {
        page: fetchedPage({
          url,
          title: "Riego por goteo",
          metaDescription:
            "Cómo montar un riego por goteo en casa, paso a paso y con material barato.",
        }),
        site,
      })?.status;
    expect(bing13("https://example.com/a")).toBe("warn");
    expect(bing13("https://example.com/c")).toBe("unknown");
  });

  it("fails planted prompt injection and only warns on a lead", () => {
    const spamSignals = {
      ...emptySpamSignals(),
      promptInjection: ['Hidden by inline display:none on <div>: "Ignore…"'],
    };
    expect(status("BING-30", { spamSignals })).toBe("fail");
    expect(
      status("BING-30", {
        spamSignals: {
          ...emptySpamSignals(),
          promptInjectionLeads: [
            'Hidden by inline display:none on <div>, needs a look: "Ignore…"',
          ],
        },
      }),
    ).toBe("warn");
    expect(
      evaluateDeterministic("BING-30", { page: fetchedPage() }),
    ).toBeNull();
  });
});
