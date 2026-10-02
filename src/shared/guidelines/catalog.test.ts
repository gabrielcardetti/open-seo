import { describe, expect, it } from "vitest";
import {
  CATALOG_VERSION,
  ENGINES,
  GUIDELINE_RULES,
  RULES_BY_ID,
  SOURCE_DOCUMENTS,
  computeVerdict,
  engineVerdictFromResults,
  evaluatedEngines,
  rulesForContext,
  verdictSeverity,
} from "./catalog";
import {
  SITE_ROW_ONLY_RULES,
  SITE_PATTERN_RULES,
  gradedRuleIds,
  judgeableRules,
  questionFor,
  statusFromAnswer,
  unjudgeableReason,
  MIN_CONFIDENCE,
} from "./judge-map";

/** A rule of the given severity, for verdict arithmetic. */
function idOfSeverity(severity: string): string {
  const rule = GUIDELINE_RULES.find((r) => r.severity === severity);
  if (!rule) throw new Error(`catalog has no ${severity} rule`);
  return rule.id;
}

describe("catalog", () => {
  // The catalog is data we replace wholesale when Google updates a source
  // document. This is the test that fails on a bad or truncated replacement.
  it("parses and carries the rules it declares", () => {
    expect(GUIDELINE_RULES).toHaveLength(134);
    expect(RULES_BY_ID.size).toBe(GUIDELINE_RULES.length);
    expect(CATALOG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives every rule a source to trace a finding back to", () => {
    const untraceable = GUIDELINE_RULES.filter((rule) =>
      rule.sources.some((source) => !source.source_url.startsWith("http")),
    );
    expect(untraceable).toEqual([]);
  });

  // A rule that can reject or send back a page has to show the words it rests
  // on, in every engine's source. A truncated quote hides whether the rule
  // says more than the engine does.
  it("quotes the official text in full for every critical and high rule", () => {
    const unquoted = GUIDELINE_RULES.filter(
      (rule) =>
        (rule.severity === "critical" || rule.severity === "high") &&
        rule.sources.some(
          (source) =>
            !source.official_quote.trim() ||
            /\.\.\.|…/.test(source.official_quote),
        ),
    ).map((rule) => rule.id);
    expect(unquoted).toEqual([]);
  });

  it("derives each rule's engines from its sources", () => {
    for (const rule of GUIDELINE_RULES) {
      expect(rule.engines, rule.id).toEqual(
        ENGINES.filter((engine) =>
          rule.sources.some((source) => source.engine === engine),
        ),
      );
    }
  });

  // The quote checker fetches each Bing source from the document it names.
  it("names a re-checkable document for every Bing source", () => {
    const undocumented = GUIDELINE_RULES.flatMap((rule) =>
      rule.sources
        .filter(
          (source) =>
            source.engine === "bing" &&
            SOURCE_DOCUMENTS[source.source]?.url !== source.source_url,
        )
        .map((source) => `${rule.id} ${source.source}`),
    );
    expect(undocumented).toEqual([]);
  });

  // A blog post is a weaker authority than the guidelines themselves: a rule
  // resting only on one may advise, not send a page back.
  it("caps rules sourced only from a blog at medium severity", () => {
    const overreaching = GUIDELINE_RULES.filter(
      (rule) =>
        rule.sources.every((source) => source.source === "SRC-BAIANS") &&
        (rule.severity === "critical" || rule.severity === "high"),
    );
    expect(overreaching).toEqual([]);
  });

  it("points every conflict at another engine's existing rule", () => {
    for (const rule of GUIDELINE_RULES) {
      for (const conflict of rule.conflicts_with ?? []) {
        const other = RULES_BY_ID.get(conflict.rule_id);
        expect(other, `${rule.id} -> ${conflict.rule_id}`).toBeDefined();
        expect(
          other!.engines.some((engine) => !rule.engines.includes(engine)),
        ).toBe(true);
      }
    }
  });
});

describe("rulesForContext", () => {
  it("asks site-scope rules only at site level and page-scope only at page level", () => {
    const page = rulesForContext({}, "page");
    const site = rulesForContext({}, "site");
    expect(page.every((r) => r.scope !== "site")).toBe(true);
    expect(site.every((r) => r.scope !== "page")).toBe(true);
    // `both` rules are judged at each level, so the sets legitimately overlap.
    expect(page.some((r) => r.scope === "both")).toBe(true);
  });

  // Asking a conditional rule when its precondition is unknown is how a judge
  // ends up inventing a YMYL verdict for a page about air fryers.
  it("leaves conditional rules out until their precondition holds", () => {
    const ids = (ctx: Parameters<typeof rulesForContext>[0]) =>
      new Set(rulesForContext(ctx, "page").map((r) => r.id));

    expect(ids({}).has("YMYL-02")).toBe(false);
    expect(ids({ ymyl: true }).has("YMYL-02")).toBe(true);
    expect(ids({ ymyl: false }).has("YMYL-02")).toBe(false);
  });

  // Adding Bing's rules must not change what a default (Google) evaluation
  // asks; asking for Bing adds its rules and the ones both engines state.
  it("asks only the selected engines' rules", () => {
    const google = rulesForContext({}, "page");
    const bing = rulesForContext({}, "page", ["bing"]);
    expect(google.every((rule) => rule.engines.includes("google"))).toBe(true);
    expect(bing.every((rule) => rule.engines.includes("bing"))).toBe(true);
    expect(bing.some((rule) => rule.id === "SPAM-10")).toBe(true);
    expect(google.some((rule) => rule.id.startsWith("BING-"))).toBe(false);
  });

  it("asks Bing Webmaster Tools rules only with a Bing connection", () => {
    const ids = (hasBwt?: boolean) =>
      rulesForContext({ hasBwt }, "page", ["bing"]).map((rule) => rule.id);
    expect(ids()).not.toContain("BING-36");
    expect(ids(true)).toContain("BING-36");
  });

  it("keeps unconditional rules in every context", () => {
    const always = GUIDELINE_RULES.filter(
      (r) =>
        r.applies_if === "always" &&
        r.scope === "page" &&
        r.engines.includes("google"),
    );
    const asked = new Set(rulesForContext({}, "page").map((r) => r.id));
    expect(always.every((r) => asked.has(r.id))).toBe(true);
  });
});

describe("computeVerdict", () => {
  it("rejects on any critical failure", () => {
    const summary = computeVerdict([
      { id: idOfSeverity("critical"), status: "fail" },
      { id: idOfSeverity("low"), status: "fail" },
    ]);
    expect(summary.verdict).toBe("reject");
    expect(summary.publishAllowed).toBe(false);
  });

  it("revises on a high failure with nothing critical", () => {
    const summary = computeVerdict([
      { id: idOfSeverity("high"), status: "fail" },
    ]);
    expect(summary.verdict).toBe("revise");
    expect(summary.publishAllowed).toBe(false);
  });

  it("warns but allows publishing on medium and low failures", () => {
    const summary = computeVerdict([
      { id: idOfSeverity("medium"), status: "fail" },
      { id: idOfSeverity("low"), status: "fail" },
    ]);
    expect(summary).toMatchObject({
      verdict: "pass_with_warnings",
      mediumFails: 1,
      lowFails: 1,
      publishAllowed: true,
    });
  });

  // `unknown` is the absence of an answer. Letting it count as a failure would
  // reject pages on missing data.
  it("never counts an unknown against a page", () => {
    const summary = computeVerdict([
      { id: idOfSeverity("critical"), status: "unknown" },
      { id: idOfSeverity("critical"), status: "n/a" },
      { id: idOfSeverity("critical"), status: "pass" },
    ]);
    expect(summary.verdict).toBe("pass");
  });

  // A detector hit or an unconfirmed judge failure cannot block a page, but a
  // page carrying one is not a clean pass either.
  it("lets a warning neither block a page nor pass it clean", () => {
    const summary = computeVerdict([
      { id: idOfSeverity("critical"), status: "warn" },
    ]);
    expect(summary.verdict).toBe("pass_with_warnings");
    expect(summary.publishAllowed).toBe(true);
  });

  // Doorways, scaled content, one URL per query variant: a pattern across pages
  // that one page can only hint at. Answered from a single page, such a rule
  // can send it back for revision but not reject it.
  it("caps a pattern rule judged from one page at revise", () => {
    const pattern = GUIDELINE_RULES.find(
      (r) => r.scope === "both" && r.severity === "critical",
    )!;
    expect(verdictSeverity(pattern, "page")).toBe("high");
    expect(verdictSeverity(pattern, "site")).toBe("critical");
    expect(computeVerdict([{ id: pattern.id, status: "fail" }]).verdict).toBe(
      "revise",
    );
    expect(
      computeVerdict([{ id: pattern.id, status: "fail" }], "site").verdict,
    ).toBe("reject");
  });

  // The point of the site pass: a page in a cluster the site judge failed
  // carries that confirmation, and a doorway set rejects page by page.
  it("rejects on a pattern failure the site pass confirmed", () => {
    expect(
      computeVerdict([{ id: "SPAM-02", status: "fail", level: "site" }])
        .verdict,
    ).toBe("reject");
    expect(computeVerdict([{ id: "SPAM-02", status: "fail" }]).verdict).toBe(
      "revise",
    );
  });

  it("ignores results for rules the catalog no longer carries", () => {
    const summary = computeVerdict([{ id: "GONE-99", status: "fail" }]);
    expect(summary.verdict).toBe("pass");
  });

  // Where Bing and Google disagree, failing Bing's preference is reported but
  // cannot send back a page Google's guidance accepts.
  it("lets a rule that conflicts with another engine's only warn", () => {
    const conflicting = GUIDELINE_RULES.find((r) => r.conflicts_with?.length);
    expect(
      computeVerdict([{ id: conflicting!.id, status: "fail" }]).verdict,
    ).toBe("pass_with_warnings");
  });
});

describe("per-engine verdicts from stored results", () => {
  const stored = [
    { ruleId: "BING-07", status: "fail" as const, severity: "high" as const },
    { ruleId: "PF-W10", status: "unknown" as const, severity: "high" as const },
    {
      ruleId: "BING-03",
      status: "unknown" as const,
      severity: "medium" as const,
    },
    {
      ruleId: "SPAM-10",
      status: "warn" as const,
      severity: "critical" as const,
    },
  ];

  it("weighs each engine's rules only", () => {
    expect(engineVerdictFromResults(stored, "google")).toMatchObject({
      verdict: "pass_with_warnings",
      unknownCount: 1,
    });
    expect(engineVerdictFromResults(stored, "bing")).toMatchObject({
      verdict: "revise",
      highFails: 1,
      unknownCount: 1,
    });
  });

  it("reads the engines an evaluation covered back from its rows", () => {
    expect(evaluatedEngines(stored, ["google"])).toEqual(["google", "bing"]);
    expect(evaluatedEngines(stored.slice(1, 2), [])).toEqual(["google"]);
    expect(evaluatedEngines([], ["google"])).toEqual(["google"]);
  });
});

describe("judgeableRules", () => {
  it("excludes what a judge cannot close on its own", () => {
    const judged = judgeableRules(GUIDELINE_RULES);
    const ids = new Set(judged.map((r) => r.id));

    expect(judged.every((r) => r.check !== "gsc" && r.check !== "human")).toBe(
      true,
    );
    // Cloaking and hacked content turn on server-side evidence the page cannot
    // carry, so they stay out even though their check type is judgeable.
    expect(ids.has("SPAM-01")).toBe(false);
    expect(ids.has("SPAM-04")).toBe(false);
    // A text judge asked about mobile layout can only guess.
    expect(ids.has("PX-02")).toBe(false);
    expect(judged.length).toBeGreaterThan(0);
  });

  it("explains every rule it declines to judge", () => {
    const declined = GUIDELINE_RULES.filter(
      (rule) => !judgeableRules([rule]).length,
    );
    expect(declined.every((rule) => unjudgeableReason(rule) !== null)).toBe(
      true,
    );
  });
});

// The pattern sets are our reading keyed by id; a catalog edit that drops an
// id or moves it off `both` must fail here rather than silently stop the site
// pass from judging it.
it("keys the site pattern sets on existing `both` rules", () => {
  for (const id of [...SITE_PATTERN_RULES, ...SITE_ROW_ONLY_RULES]) {
    expect(RULES_BY_ID.get(id)?.scope, id).toBe("both");
  }
});

describe("statusFromAnswer", () => {
  const binary = RULES_BY_ID.get("PF-W01")!;
  const scored = RULES_BY_ID.get("PF-Q01")!;

  it("maps a confident binary answer straight through", () => {
    expect(statusFromAnswer(binary, { label: "pass", confidence: 0.9 })).toBe(
      "pass",
    );
    expect(statusFromAnswer(binary, { label: "fail", confidence: 0.9 })).toBe(
      "fail",
    );
  });

  // The whole point of a calibrated judge: a coin flip is reported as a coin
  // flip and routed onward, not recorded as a finding.
  it("returns unknown below the confidence floor", () => {
    expect(
      statusFromAnswer(binary, {
        label: "fail",
        confidence: MIN_CONFIDENCE - 0.01,
      }),
    ).toBe("unknown");
  });

  it("grades a scored rule against the passing level", () => {
    expect(questionFor(scored).kind).toBe("score");
    expect(statusFromAnswer(scored, { index: 4, confidence: 0.9 })).toBe(
      "pass",
    );
    expect(statusFromAnswer(scored, { index: 2, confidence: 0.9 })).toBe(
      "pass",
    );
    expect(statusFromAnswer(scored, { index: 1, confidence: 0.9 })).toBe(
      "warn",
    );
    expect(statusFromAnswer(scored, { index: 0, confidence: 0.9 })).toBe(
      "fail",
    );
  });

  it("returns unknown for a label outside the question's options", () => {
    expect(statusFromAnswer(binary, { label: "maybe", confidence: 0.99 })).toBe(
      "unknown",
    );
    expect(
      statusFromAnswer(scored, { label: "excellent", confidence: 0.99 }),
    ).toBe("unknown");
  });

  it("only claims to grade rules the catalog actually carries", () => {
    expect(gradedRuleIds().length).toBeGreaterThan(0);
    expect(gradedRuleIds().every((id) => RULES_BY_ID.has(id))).toBe(true);
  });
});
