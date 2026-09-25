import { describe, expect, it } from "vitest";
import type { RuleStatus } from "@/shared/guidelines/catalog";
import { combineWithSite, type SiteRuleAnswer } from "./site-combine";

const site = (
  status: RuleStatus,
  clusters = ["C1"],
  identicalText = false,
): SiteRuleAnswer => ({
  status,
  clusters,
  identicalText,
  evidence: 'C1: 214 pages /:slug "Abogados en {*}"',
  reason: "City-swap doorways.",
});

describe("combineWithSite", () => {
  // Site status, clusters it cites, clusters the page is in, rule, page
  // status -> combined status.
  it.each([
    ["fail", ["C1"], ["C1"], "SPAM-02", "pass", "fail"],
    ["fail", ["C1"], ["C1"], "SPAM-02", "unknown", "fail"],
    // One bad section must not smear the pages outside it.
    ["fail", ["C1"], [], "SPAM-02", "pass", "pass"],
    ["fail", ["C1"], ["C2"], "SPAM-02", "pass", "pass"],
    ["warn", ["C1"], ["C1"], "SPAM-02", "pass", "warn"],
    ["warn", ["C1"], ["C1"], "SPAM-02", "fail", "fail"],
    ["warn", ["C1"], [], "SPAM-02", "pass", "pass"],
    // An answer that cites no cluster is about no page in particular.
    ["fail", [], ["C1"], "SPAM-02", "pass", "pass"],
    // Topic scatter is not a template: it stays on the site row.
    ["fail", ["C1"], ["C1"], "PF-W02", "pass", "pass"],
    ["warn", ["C1"], ["C1"], "PF-W03", "pass", "pass"],
    // A site pass never clears a page: small doorway sets are below the
    // cluster size, so the inventory cannot show them.
    ["pass", [], [], "SPAM-02", "fail", "fail"],
    ["unknown", ["C1"], ["C1"], "SPAM-02", "fail", "fail"],
    [null, [], ["C1"], "SPAM-02", "pass", "pass"],
  ] satisfies Array<
    [RuleStatus | null, string[], string[], string, RuleStatus, RuleStatus]
  >)("site %s on %j, page in %j: %s %s -> %s", (...row) => {
    const [siteStatus, cited, memberOf, ruleId, pageStatus, expected] = row;
    const result = combineWithSite(
      { ruleId, status: pageStatus },
      siteStatus ? site(siteStatus, cited) : undefined,
      memberOf,
    );
    expect(result.status).toBe(expected);
  });

  // Only identical text lets the site's answer reject a member page. Near-
  // identical word counts also fit product variants and fixed-size listings,
  // so there the page is sent back for revision and the site row rejects.
  it.each([
    [true, "site"],
    [false, "page"],
  ] as const)(
    "escalates with level %s identical text -> %s and names the cluster",
    (identicalText, level) => {
      const result = combineWithSite(
        { ruleId: "SPAM-02", status: "pass" },
        site("fail", ["C1"], identicalText),
        ["C1"],
      );
      expect(result).toMatchObject({ status: "fail", level, clusters: ["C1"] });
      expect(result.evidence).toContain("cluster C1");
    },
  );
});
