import { describe, expect, it } from "vitest";
import { compareAudits } from "./compare";

describe("compareAudits", () => {
  it("matches issues by type and URL, and verdicts by URL", () => {
    const diff = compareAudits(
      {
        pageUrls: ["/a", "/b"],
        issues: [
          { issueType: "title-too-long", pageUrl: "/a" },
          { issueType: "title-too-long", pageUrl: "/b" },
        ],
        verdicts: new Map([
          ["/a", "revise"],
          ["/b", "pass"],
        ]),
      },
      {
        pageUrls: ["/a", "/c"],
        issues: [
          { issueType: "title-too-long", pageUrl: "/a" },
          { issueType: "title-too-long", pageUrl: "/c" },
        ],
        verdicts: new Map([["/a", "pass"]]),
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
    expect(diff.guidelines.improved).toEqual([
      { url: "/a", before: "revise", after: "pass" },
    ]);
  });
});
