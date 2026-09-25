import { describe, expect, it } from "vitest";
import { GUIDELINE_RULES } from "@/shared/guidelines/catalog";
import { evaluateDeterministic } from "./rule-evaluators";
import type { FetchedPage } from "./page-fetch";
import { emptySpamSignals } from "./spam-signals";

function fetchedPage(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    url: "https://example.com/a",
    finalUrl: "https://example.com/a",
    statusCode: 200,
    title: "A",
    metaDescription: "",
    canonical: null,
    robotsMeta: null,
    googlebotMeta: null,
    robotsHeader: null,
    h1s: [],
    wordCount: 300,
    bodyText: "Texto.",
    structuredData: [],
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
    isHttps: true,
    spamSignals: emptySpamSignals(),
    ...overrides,
  };
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
