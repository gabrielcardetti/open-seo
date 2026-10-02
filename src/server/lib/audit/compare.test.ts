import { describe, expect, it } from "vitest";
import { compareAudits } from "./compare";

const snapshot = (hashes: Array<[string, string]>) => ({
  pageUrls: ["/same", "/edited", "/unhashed"],
  contentHashes: new Map(hashes),
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
