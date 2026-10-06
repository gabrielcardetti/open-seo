import { describe, expect, it } from "vitest";
import { compareAudits } from "./compare";

const snapshot = (hashes: Array<[string, string]>) => ({
  pageUrls: ["/same", "/edited", "/unhashed"],
  contentHashes: new Map(hashes),
  signals: new Map(),
  issues: [],
  verdicts: new Map<string, string>(),
  siteVerdict: null,
});

describe("compareAudits", () => {
  it("matches issues by type and URL, and verdicts by URL", () => {
    const diff = compareAudits(
      {
        pageUrls: ["/a", "/b"],
        contentHashes: new Map(),
        signals: new Map(),
        issues: [
          { issueType: "title-too-long", pageUrl: "/a" },
          { issueType: "title-too-long", pageUrl: "/b" },
        ],
        verdicts: new Map([
          ["/a", "revise"],
          ["/b", "pass"],
        ]),
        siteVerdict: null,
      },
      {
        pageUrls: ["/a", "/c"],
        contentHashes: new Map(),
        signals: new Map(),
        issues: [
          { issueType: "title-too-long", pageUrl: "/a" },
          { issueType: "title-too-long", pageUrl: "/c" },
        ],
        verdicts: new Map([["/a", "pass"]]),
        siteVerdict: null,
      },
    );

    expect(diff.pages.added).toEqual(["/c"]);
    expect(diff.pages.removed).toEqual(["/b"]);
    // Same count before and after, but one fixed and one new.
    expect(diff.issues.byType).toEqual([
      {
        issueType: "title-too-long",
        before: 2,
        after: 2,
        resolved: 1,
        introduced: 1,
      },
    ]);
    // On the URLs both audits crawled, nothing changed: /b left the sample
    // and /c entered it, neither was fixed or broken.
    expect(diff.issues.common.byType).toEqual([
      {
        issueType: "title-too-long",
        before: 1,
        after: 1,
        resolved: 0,
        introduced: 0,
      },
    ]);
    expect(diff.guidelines.improved).toEqual([
      { url: "/a", before: "revise", after: "pass" },
    ]);
  });

  it("reports pages whose content changed, not ones without a hash", () => {
    const diff = compareAudits(
      snapshot([
        ["/same", "h1"],
        ["/edited", "h2"],
      ]),
      snapshot([
        ["/same", "h1"],
        ["/edited", "h3"],
        ["/unhashed", "h4"],
      ]),
    );

    expect(diff.pages.changed).toEqual(["/edited"]);
  });
});

type Signals =
  Parameters<typeof compareAudits>[0]["signals"] extends ReadonlyMap<
    string,
    infer T
  >
    ? T
    : never;

const SIGNALS: Signals = {
  statusCode: 200,
  canonicalUrl: "https://example.com/a",
  isIndexable: true,
  title: "Blue mugs",
  metaDescription: "Hand-made blue mugs.",
  h1Text: "Blue mugs",
  ogTitle: "Blue mugs",
  ogDescription: "Hand-made blue mugs.",
  ogImage: "https://example.com/mug.png",
  hasStructuredData: true,
  schemaTypes: ["Product"],
};

function drift(before: Partial<Signals>, after: Partial<Signals>) {
  const audit = (signals: Partial<Signals>) => ({
    pageUrls: ["/a"],
    contentHashes: new Map(),
    signals: new Map([["/a", { ...SIGNALS, ...signals }]]),
    issues: [],
    verdicts: new Map(),
    siteVerdict: null,
  });
  return compareAudits(audit(before), audit(after)).drift;
}

describe("compareAudits drift", () => {
  it.each<[string, Partial<Signals>, Partial<Signals>, string[]]>([
    ["nothing", {}, {}, []],
    ["a whitespace-only edit", {}, { title: "  Blue   mugs " }, []],
    [
      "a canonical pointed elsewhere",
      {},
      { canonicalUrl: "https://example.com/b" },
      ["canonical-changed"],
    ],
    ["a canonical removed", {}, { canonicalUrl: null }, ["canonical-removed"]],
    ["a noindex added", {}, { isIndexable: false }, ["noindex-added"]],
    ["a title removed", {}, { title: "" }, ["title-removed"]],
    ["a title rewritten", {}, { title: "Mugs" }, ["title-changed"]],
    [
      "a meta description removed",
      {},
      { metaDescription: null },
      ["meta-description-changed"],
    ],
    ["an H1 removed", {}, { h1Text: null }, ["h1-removed"]],
    ["an H1 rewritten", {}, { h1Text: "Mugs" }, ["h1-changed"]],
    ["an og:image removed", {}, { ogImage: null }, ["og-tags-removed"]],
    [
      "structured data removed",
      {},
      { hasStructuredData: false, schemaTypes: [] },
      ["structured-data-removed"],
    ],
    [
      "structured data added",
      { hasStructuredData: false, schemaTypes: [] },
      {},
      ["structured-data-added"],
    ],
    [
      "a schema type swapped",
      {},
      { schemaTypes: ["Article"] },
      ["schema-types-changed"],
    ],
    // An error replaces every content signal; only the error is drift.
    ["a page now 404", {}, { statusCode: 404, title: null }, ["status-error"]],
    ["a page still 404", { statusCode: 404 }, { statusCode: 410 }, []],
    // An audit from before H1 text and schema types were stored.
    [
      "a base audit without the newer signals",
      { h1Text: null, schemaTypes: [] },
      {},
      [],
    ],
  ])("reports %s as %j", (_case, before, after, expected) => {
    expect(drift(before, after).rules.map((rule) => rule.rule)).toEqual(
      expected,
    );
  });

  it("counts each rule with its severity and the change", () => {
    expect(drift({}, { title: null, metaDescription: "Mugs." })).toEqual({
      urls: 1,
      rules: [
        {
          rule: "title-removed",
          severity: "critical",
          count: 1,
          changes: [{ url: "/a", before: "Blue mugs", after: null }],
        },
        {
          rule: "meta-description-changed",
          severity: "warning",
          count: 1,
          changes: [
            { url: "/a", before: "Hand-made blue mugs.", after: "Mugs." },
          ],
        },
      ],
    });
  });
});
