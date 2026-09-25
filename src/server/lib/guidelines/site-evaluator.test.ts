import { describe, expect, it } from "vitest";
import { renderPageState, type JudgedRule, type RuleJudge } from "./judge";
import { evaluatePage, type PageEvaluation } from "./page-evaluator";
import type { FetchedPage } from "./page-fetch";
import type { PatternCluster, SiteFacts } from "./site-facts";
import { evaluateSite, finalizeSite, siteContextFor } from "./site-evaluator";
import { emptySpamSignals } from "./spam-signals";

const ORIGIN = "https://example.com";
const doorway = `${ORIGIN}/abogados-en-madrid`;
const unshownMember = `${ORIGIN}/abogados-en-sevilla`;

function cluster(overrides: Partial<PatternCluster> = {}): PatternCluster {
  return {
    id: "C1",
    kind: "title_skeleton",
    template: "/:slug",
    key: "Abogados en {*} | Firma",
    size: 214,
    wordRange: [430, 434],
    wordCv: 0.01,
    medianWords: 432,
    memberUrls: [doorway, unshownMember],
    membersTruncated: true,
    examples: [{ url: doorway, title: "Abogados en Madrid | Firma" }],
    ...overrides,
  };
}

function siteFacts(overrides: Partial<SiteFacts> = {}): SiteFacts {
  return {
    origin: ORIGIN,
    sentinelUrl: `${ORIGIN}/#site`,
    pagesCrawled: 240,
    indexablePages: 230,
    crawlCompleted: true,
    homepage: null,
    templates: [],
    clusters: [cluster()],
    titleSample: [],
    trust: {
      about: `${ORIGIN}/quienes-somos`,
      contact: null,
      privacy: null,
      terms: null,
      authorTemplate: null,
    },
    ugcSurfaces: [],
    tripwires: [],
    ...overrides,
  };
}

/** A language judge that fails the given rules, and passes the rest. */
function siteJudge(
  failing: string[],
  evidence = doorway,
  clusters = ["C1"],
): RuleJudge {
  return {
    name: "llm",
    modelId: "stub-llm",
    async judge({ rules }) {
      return rules.map(
        (rule): JudgedRule =>
          failing.includes(rule.id)
            ? { ruleId: rule.id, status: "fail", clusters, evidence }
            : { ruleId: rule.id, status: "pass" },
      );
    },
  };
}

const passingJudge: RuleJudge = {
  name: "llm",
  modelId: "stub-llm",
  async judge({ rules }) {
    return rules.map((rule) => ({ ruleId: rule.id, status: "pass" as const }));
  },
};

function fetchedPage(url: string): FetchedPage {
  return {
    url,
    finalUrl: url,
    statusCode: 200,
    title: "Abogados en Madrid | Firma",
    metaDescription: "",
    canonical: null,
    robotsMeta: null,
    googlebotMeta: null,
    robotsHeader: null,
    h1s: [],
    wordCount: 430,
    bodyText: "Abogados en Madrid con experiencia.",
    structuredData: [],
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: 5,
    externalLinks: 0,
    isHttps: true,
    spamSignals: emptySpamSignals(),
  };
}

const finding = (evaluation: PageEvaluation, ruleId: string) =>
  evaluation.findings.find((f) => f.ruleId === ruleId);

describe("evaluateSite", () => {
  // City-swap doorways: the same page with a different city, 430-434 words.
  it("rejects a site whose cited cluster is stamped out", async () => {
    const result = await evaluateSite({
      facts: siteFacts(),
      languageJudge: siteJudge(["SPAM-02"]),
    });
    expect(result.url).toBe(`${ORIGIN}/#site`);
    expect(result.classification.pageType).toBe("site");
    expect(result.verdict).toBe("reject");
    expect(finding(result, "SPAM-02")).toMatchObject({
      status: "fail",
      severity: "critical",
      clusters: ["C1"],
    });
  });

  // A real catalog shares a template and a title pattern too, and its cv is
  // as low as a doorway's (boilerplate dominates the word count); only the
  // spread of its own content tells them apart.
  it("keeps a failure on a catalog whose pages vary by hundreds of words as a warning", async () => {
    const result = await evaluateSite({
      facts: siteFacts({
        clusters: [
          cluster({
            size: 20,
            key: "Oposiciones en {*}",
            wordRange: [700, 950],
            wordCv: 0.08,
          }),
        ],
      }),
      languageJudge: siteJudge(["SPAM-11"]),
    });
    expect(finding(result, "SPAM-11")).toMatchObject({ status: "warn" });
  });

  it.each([
    // Real clusters are grounding enough, however the evidence restates them.
    [
      "SPAM-02",
      'C1: 20 pages "Abogados en {*} | Firma", words 430-434',
      ["C1"],
      "fail",
    ],
    // A member the examples do not show is still the inventory's own.
    ["PF-W02", "/abogados-en-sevilla", [], "fail"],
    ["PF-W02", `${ORIGIN}/abogados-en-narnia`, [], "warn"],
  ])(
    "grounds %s on %j citing %j as %s",
    async (ruleId, evidence, clusters, status) => {
      const result = await evaluateSite({
        facts: siteFacts(),
        languageJudge: siteJudge([ruleId], evidence, clusters),
      });
      expect(finding(result, ruleId)).toMatchObject({ status });
    },
  );

  it("drops cited clusters the facts never had", async () => {
    const result = await evaluateSite({
      facts: siteFacts(),
      languageJudge: siteJudge(["SPAM-02"], doorway, ["C1", "C9"]),
    });
    expect(finding(result, "SPAM-02")).toMatchObject({
      status: "fail",
      clusters: ["C1"],
    });
  });

  // URLs and titles never go to the decision model.
  it("leaves judged rules unknown without a language model", async () => {
    const result = await evaluateSite({ facts: siteFacts() });
    expect(finding(result, "SPAM-02")).toMatchObject({ status: "unknown" });
    expect(finding(result, "SPAM-02")?.reason).toContain("language model");
  });

  it("keeps a failure on a cluster the facts never had as a warning", async () => {
    const result = await evaluateSite({
      facts: siteFacts({ clusters: [] }),
      languageJudge: siteJudge(["SPAM-02"], "C1"),
    });
    expect(finding(result, "SPAM-02")).toMatchObject({ status: "warn" });
  });

  // A crawl cut at its page limit may not have reached the contact page, and
  // a lexicon hit is a lead for a reviewer, never a verdict.
  it("treats absence on a truncated crawl as unknown and tripwires as warnings", async () => {
    const result = await evaluateSite({
      facts: siteFacts({
        crawlCompleted: false,
        trust: { ...siteFacts().trust, about: null },
        tripwires: [
          {
            ruleId: "SPAM-04",
            url: `${ORIGIN}/cheap-viagra`,
            title: "Cheap viagra",
            why: "pharma term in title",
          },
        ],
      }),
    });
    expect(finding(result, "EAT-06")).toMatchObject({ status: "unknown" });
    expect(finding(result, "SPAM-04")).toMatchObject({ status: "warn" });
    expect(finding(result, "SPAM-04")?.evidence).toContain("/cheap-viagra");
  });

  it("keeps the deterministic answers when the judge fails", async () => {
    const failing: RuleJudge = {
      name: "llm",
      modelId: "stub-llm",
      judge: async () => {
        throw new Error("rate limited");
      },
    };
    const result = await evaluateSite({
      facts: siteFacts({ trust: { ...siteFacts().trust, about: null } }),
      languageJudge: failing,
    });
    expect(finding(result, "EAT-06")).toMatchObject({ status: "fail" });
    expect(finding(result, "SPAM-02")).toMatchObject({ status: "unknown" });
    expect(result.judge).toBe("deterministic");
  });
});

describe("finalizeSite", () => {
  it("warns when none of the sampled articles names an author", async () => {
    const site = await evaluateSite({
      facts: siteFacts(),
      languageJudge: passingJudge,
    });
    expect(finding(site, "SITE-04")).toMatchObject({ status: "unknown" });
    const article = { pageType: "article", who01Status: "fail" as const };
    const finalized = finalizeSite(site, [article, article, article]);
    expect(finding(finalized, "SITE-04")).toMatchObject({ status: "warn" });
    expect(finalized.verdict).toBe("pass_with_warnings");
  });
});

describe("siteContextFor", () => {
  // The point of the site pass: a doorway page that reads fine alone is
  // judged as one of its cluster, and a page outside it is not. Identical text
  // rejects the member; near-identical word counts, which also fit product
  // variants, send it back for revision while the site row rejects.
  it.each([
    ["exact_body", "reject", "critical"],
    ["title_skeleton", "revise", "high"],
  ] as const)(
    "escalates a member of a failed %s cluster to %s",
    async (kind, verdict, severity) => {
      const facts = siteFacts({ clusters: [cluster({ kind })] });
      const site = await evaluateSite({
        facts,
        languageJudge: siteJudge(["SPAM-02"]),
      });
      expect(site.verdict).toBe("reject");
      const judgePage = (url: string) =>
        evaluatePage({
          page: fetchedPage(url),
          languageJudge: passingJudge,
          siteContext: siteContextFor(facts, site, url),
        });

      const member = await judgePage(doorway);
      expect(member.verdict).toBe(verdict);
      expect(finding(member, "SPAM-02")).toMatchObject({
        status: "fail",
        severity,
      });

      const outsider = await judgePage(`${ORIGIN}/blog/otra-cosa`);
      expect(finding(outsider, "SPAM-02")).toBeUndefined();
    },
  );

  // Read back from the database a finding has no cluster list, only its
  // evidence. A level name such as "Inglés C2" in a quoted title must not
  // count as citing cluster C2.
  it("reads cited clusters only from the evidence's anchored prefix", async () => {
    const facts = siteFacts({
      clusters: [cluster(), cluster({ id: "C2", memberUrls: [unshownMember] })],
    });
    const judged = await evaluateSite({
      facts,
      languageJudge: siteJudge(["SPAM-02"]),
    });
    const stored: PageEvaluation = {
      ...judged,
      findings: judged.findings.map((f) =>
        f.ruleId === "SPAM-02"
          ? {
              ...f,
              clusters: undefined,
              evidence:
                '[clusters: C1] C1: 214 pages — "Curso de Inglés C2 en Madrid"',
            }
          : f,
      ),
    };
    const context = siteContextFor(facts, stored, unshownMember);
    expect(context.answers["SPAM-02"]?.clusters).toEqual(["C1"]);
  });

  // On a legitimate catalog the template alone would prime a SPAM-11 fail.
  it("tells the page judge about its template only when the site flagged it", async () => {
    const facts = siteFacts();
    const render = async (judge: RuleJudge) =>
      renderPageState(
        fetchedPage(doorway),
        null,
        siteContextFor(
          facts,
          await evaluateSite({ facts, languageJudge: judge }),
          doorway,
        ),
      );

    expect(await render(siteJudge(["SPAM-02"]))).toContain(
      "site-level SPAM-02: fail on cluster C1",
    );
    expect(await render(passingJudge)).not.toContain("TEMPLATE");
  });
});
