import { sort } from "remeda";
import { describe, expect, it, vi } from "vitest";
import { classifyPage, evaluatePage } from "./page-evaluator";
import type { FetchedPage } from "./page-fetch";
import type { JudgedRule, RuleJudge } from "./judge";

function fetchedPage(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    url: "https://example.com/guias/una-guia",
    finalUrl: "https://example.com/guias/una-guia",
    statusCode: 200,
    title: "Una guía cualquiera",
    metaDescription: "Descripción",
    canonical: "https://example.com/guias/una-guia",
    robotsMeta: null,
    h1s: ["Una guía cualquiera"],
    wordCount: 900,
    bodyText: "Contenido de la página con bastante texto útil.",
    structuredData: [],
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: 10,
    externalLinks: 2,
    isHttps: true,
    ...overrides,
  };
}

/** A judge that answers whatever it is told to, and records what it was asked. */
function stubJudge(
  name: "jev" | "llm",
  answers: (rules: readonly { id: string }[]) => JudgedRule[],
): RuleJudge & { askedRuleIds: string[][] } {
  const askedRuleIds: string[][] = [];
  return {
    name,
    modelId: `stub-${name}`,
    askedRuleIds,
    async judge({ rules }) {
      askedRuleIds.push(rules.map((rule) => rule.id));
      return answers(rules);
    },
  };
}

const rank = (severity: string) =>
  ["critical", "high", "medium", "low"].indexOf(severity);

const passAll = (rules: readonly { id: string }[]): JudgedRule[] =>
  rules.map((rule) => ({
    ruleId: rule.id,
    status: "pass" as const,
    confidence: 0.9,
  }));

describe("classifyPage", () => {
  it("flags a page about public-sector exams as YMYL", () => {
    const classification = classifyPage(
      fetchedPage({
        title: "Convocatoria de la oposición",
        bodyText:
          "La convocatoria del boletín oficial regula el proceso de oposición.",
      }),
    );
    expect(classification.ymyl).toBe(true);
    expect(classification.ymylTopics).toContain("government_civics_society");
  });

  it("flags health content as YMYL", () => {
    const classification = classifyPage(
      fetchedPage({
        bodyText: "El tratamiento de esta enfermedad requiere dosis.",
      }),
    );
    expect(classification.ymylTopics).toContain("health_safety");
  });

  it("leaves an ordinary page outside YMYL", () => {
    expect(classifyPage(fetchedPage()).ymyl).toBe(false);
  });

  it("recognises a listicle as a review page", () => {
    const classification = classifyPage(
      fetchedPage({
        title: "Las 10 mejores 5 freidoras",
        h1s: ["Las mejores 5 freidoras"],
      }),
    );
    expect(classification.isReview).toBe(true);
    expect(classification.pageType).toBe("review");
  });
});

describe("evaluatePage", () => {
  it("asks the YMYL rules only on a YMYL page", async () => {
    const judge = stubJudge("llm", passAll);
    await evaluatePage({
      page: fetchedPage({ bodyText: "Texto normal sin nada especial." }),
      languageJudge: judge,
    });
    const ordinary = judge.askedRuleIds.flat();

    const ymylJudge = stubJudge("llm", passAll);
    await evaluatePage({
      page: fetchedPage({
        bodyText: "El tratamiento de la enfermedad y su diagnóstico médico.",
      }),
      languageJudge: ymylJudge,
    });
    const ymyl = ymylJudge.askedRuleIds.flat();

    // YMYL-03 is one of the two rules the catalog gates on `applies_if: ymyl`.
    expect(ordinary).not.toContain("YMYL-03");
    expect(ymyl).toContain("YMYL-03");
  });

  it("asks the review rules only on a review page", async () => {
    const judge = stubJudge("llm", passAll);
    await evaluatePage({
      page: fetchedPage({ title: "Las 10 mejores 5 freidoras" }),
      languageJudge: judge,
    });
    expect(judge.askedRuleIds.flat()).toContain("REV-01");

    const plain = stubJudge("llm", passAll);
    await evaluatePage({ page: fetchedPage(), languageJudge: plain });
    expect(plain.askedRuleIds.flat()).not.toContain("REV-01");
  });

  it("asks the schema rules only when the page carries markup", async () => {
    const judge = stubJudge("llm", passAll);
    await evaluatePage({ page: fetchedPage(), languageJudge: judge });
    expect(judge.askedRuleIds.flat()).not.toContain("SD-03");

    const withSchema = stubJudge("llm", passAll);
    await evaluatePage({
      page: fetchedPage({ structuredData: [{ "@type": "Article" }] }),
      languageJudge: withSchema,
    });
    expect(withSchema.askedRuleIds.flat()).toContain("SD-03");
  });

  it("never asks a judge a site-scope rule", async () => {
    const judge = stubJudge("llm", passAll);
    await evaluatePage({ page: fetchedPage(), languageJudge: judge });
    const asked = judge.askedRuleIds.flat();
    // One doorway page looks fine on its own; these are answered from the URL
    // inventory instead, so they must not reach a page-level judge.
    expect(asked).not.toContain("SITE-01");
    expect(asked).not.toContain("SITE-03");
  });

  it("settles deterministic rules without asking a judge", async () => {
    const judge = stubJudge("llm", passAll);
    await evaluatePage({
      page: fetchedPage({ robotsMeta: "noindex" }),
      languageJudge: judge,
    });
    expect(judge.askedRuleIds.flat()).not.toContain("TECH-04");
  });

  it("rejects a page whose deterministic evidence is a critical failure", async () => {
    const result = await evaluatePage({
      page: fetchedPage({ robotsMeta: "noindex" }),
      languageJudge: stubJudge("llm", passAll),
    });
    expect(result.verdict).toBe("reject");
    const noindex = result.findings.find((f) => f.ruleId === "TECH-04");
    expect(noindex).toMatchObject({ status: "fail", severity: "critical" });
  });

  // The saving that makes the two-stage design worth having.
  it("only sends the decision model's flags to the language model", async () => {
    const decision = stubJudge("jev", (rules) =>
      rules.map((rule, index) => ({
        ruleId: rule.id,
        status: index === 0 ? ("fail" as const) : ("pass" as const),
        confidence: 0.95,
      })),
    );
    const language = stubJudge("llm", (rules) =>
      rules.map((rule) => ({
        ruleId: rule.id,
        status: "fail" as const,
        evidence: "quoted text",
        reason: "because",
      })),
    );

    const result = await evaluatePage({
      page: fetchedPage(),
      decisionJudge: decision,
      languageJudge: language,
    });

    const askedSecond = language.askedRuleIds.flat();
    expect(askedSecond).toHaveLength(1);
    expect(
      result.findings.find((f) => f.ruleId === askedSecond[0]),
    ).toMatchObject({
      evidence: "quoted text",
    });
  });

  it("sends an uncertain answer for a second opinion even when it passed", async () => {
    const decision = stubJudge("jev", (rules) =>
      rules.map((rule, index) => ({
        ruleId: rule.id,
        // `unknown` is what a below-threshold confidence becomes.
        status: index === 0 ? ("unknown" as const) : ("pass" as const),
        confidence: index === 0 ? 0.05 : 0.95,
      })),
    );
    const language = stubJudge("llm", passAll);
    await evaluatePage({
      page: fetchedPage(),
      decisionJudge: decision,
      languageJudge: language,
    });
    expect(language.askedRuleIds.flat()).toHaveLength(1);
  });

  it("records rules nobody could answer as unknown, not as passes", async () => {
    const result = await evaluatePage({ page: fetchedPage() });
    expect(result.unknownCount).toBeGreaterThan(0);
    expect(result.judge).toBe("deterministic");
    // An unanswered rule must never silently become a passing verdict.
    const unknowns = result.findings.filter((f) => f.status === "unknown");
    expect(unknowns.length).toBe(result.unknownCount);
    expect(unknowns.every((f) => f.reason)).toBe(true);
  });

  it("carries the catalog's own remediation, never a model's", async () => {
    const result = await evaluatePage({
      page: fetchedPage({ robotsMeta: "noindex" }),
    });
    const finding = result.findings.find((f) => f.ruleId === "TECH-04");
    expect(finding?.remediation).toBeTruthy();
  });

  it("orders findings by severity", async () => {
    const result = await evaluatePage({
      page: fetchedPage({ robotsMeta: "noindex", isHttps: false }),
    });
    const ranks = result.findings.map((f) => f.severity);
    expect(ranks.map(rank)).toEqual(sort(ranks.map(rank), (a, b) => a - b));
  });

  it("fails a page that serves no readable text", async () => {
    const result = await evaluatePage({
      page: fetchedPage({ wordCount: 0, bodyText: "" }),
    });
    expect(result.findings.find((f) => f.ruleId === "TECH-03")?.status).toBe(
      "fail",
    );
  });

  it("propagates a judge failure instead of reporting a clean page", async () => {
    const failing: RuleJudge = {
      name: "llm",
      modelId: "broken",
      judge: vi.fn().mockRejectedValue(new Error("upstream 500")),
    };
    await expect(
      evaluatePage({ page: fetchedPage(), languageJudge: failing }),
    ).rejects.toThrow("upstream 500");
  });
});
