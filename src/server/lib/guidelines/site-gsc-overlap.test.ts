import { describe, expect, it } from "vitest";
import { buildBingSiteFacts } from "./bing-site-facts";
import { bodyShingleFingerprint } from "./body-fingerprint";
import { renderSiteState, type JudgedRule, type RuleJudge } from "./judge";
import type { PageEvaluation } from "./page-evaluator";
import type { PatternCluster, SiteFacts } from "./site-facts";
import {
  buildSiteGscIndexing,
  type SiteGscInspectionInput,
} from "./site-gsc-facts";
import { evaluateSite, finalizeSite } from "./site-evaluator";

const ORIGIN = "https://example.com";
const doorway = `${ORIGIN}/calendario-laboral-bilbao`;
const sibling = `${ORIGIN}/calendario-laboral-donostia`;

function cluster(overrides: Partial<PatternCluster> = {}): PatternCluster {
  return {
    id: "C1",
    kind: "title_skeleton",
    template: "/:slug",
    key: "Calendario laboral {*} 2026",
    size: 12,
    wordRange: [300, 480],
    wordCv: 0.14,
    medianWords: 390,
    memberUrls: [doorway, sibling],
    membersTruncated: true,
    examples: [{ url: doorway, title: "Calendario laboral Bilbao 2026" }],
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
    bing: buildBingSiteFacts({ pages: [], startUrl: `${ORIGIN}/` }),
    ...overrides,
  };
}

const passingJudge: RuleJudge = {
  name: "llm",
  modelId: "stub-llm",
  async judge({ rules }) {
    return rules.map((rule) => ({ ruleId: rule.id, status: "pass" as const }));
  },
};

function failingJudge(ruleId: string): RuleJudge {
  return {
    name: "llm",
    modelId: "stub-llm",
    async judge({ rules }) {
      return rules.map(
        (rule): JudgedRule =>
          rule.id === ruleId
            ? {
                ruleId: rule.id,
                status: "fail",
                clusters: ["C1"],
                evidence: doorway,
              }
            : { ruleId: rule.id, status: "pass" },
      );
    },
  };
}

const finding = (evaluation: PageEvaluation, ruleId: string) =>
  evaluation.findings.find((f) => f.ruleId === ruleId);

function gscRows(
  prefix: string,
  count: number,
  verdict: string,
  coverageState: string,
): SiteGscInspectionInput[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `${ORIGIN}${prefix}${i + 1}`,
    inSitemap: true,
    verdict,
    coverageState,
  }));
}

describe("SITE-06 (GSC thin ratio / crawled-not-indexed)", () => {
  it("fails when a large sitemap section sits mostly in Crawled/Discovered - not indexed", async () => {
    const gscIndexing = buildSiteGscIndexing([
      ...gscRows("/core/page-", 60, "PASS", "Submitted and indexed"),
      ...gscRows(
        "/bopv/2026/doc-",
        40,
        "NEUTRAL",
        "Crawled - currently not indexed",
      ),
      ...gscRows(
        "/bopv/2026/disc-",
        10,
        "NEUTRAL",
        "Discovered - currently not indexed",
      ),
    ]);
    const facts = siteFacts({ gscIndexing });
    const result = await evaluateSite({ facts, languageJudge: passingJudge });
    expect(finding(result, "SITE-06")).toMatchObject({ status: "fail" });
    expect(finding(result, "SITE-06")?.evidence).toContain("/bopv/2026/*");
    expect(renderSiteState(facts)).toContain("GSC INDEXING:");
    expect(renderSiteState(facts)).toContain("GSC section /bopv/2026/*");
  });

  it("passes when most inspected sitemap URLs are indexed with low quality exclusion", async () => {
    const gscIndexing = buildSiteGscIndexing([
      ...gscRows("/core/page-", 45, "PASS", "Submitted and indexed"),
      ...gscRows(
        "/core/pending-",
        3,
        "NEUTRAL",
        "Crawled - currently not indexed",
      ),
    ]);
    const result = await evaluateSite({
      facts: siteFacts({ gscIndexing }),
      languageJudge: passingJudge,
    });
    expect(result.applicableRuleIds).toContain("SITE-06");
    expect(finding(result, "SITE-06")).toBeUndefined();
  });

  it("stays unknown when fewer than 20 monitored sitemap URLs have been inspected", async () => {
    const gscIndexing = buildSiteGscIndexing(
      gscRows("/core/page-", 10, "NEUTRAL", "Crawled - currently not indexed"),
    );
    const result = await evaluateSite({
      facts: siteFacts({ gscIndexing }),
      languageJudge: passingJudge,
    });
    expect(finding(result, "SITE-06")?.status).toBe("unknown");
  });
});

describe("finalizeSite body-overlap corroboration", () => {
  const sharedBody =
    "El calendario laboral oficial del municipio fija catorce festivos retribuidos y no recuperables durante todo el ejercicio anual incluyendo doce festivos comunes estatales y autonomicos publicados por decreto oficial y dos fiestas locales propias aprobadas por el pleno municipal para cada localidad.";

  it("promotes an uncorroborated doorway warn to fail when sampled siblings share >=50% body overlap", async () => {
    const facts = siteFacts();
    const initial = await evaluateSite({
      facts,
      languageJudge: failingJudge("SPAM-02"),
    });
    expect(finding(initial, "SPAM-02")?.status).toBe("warn");

    const finalized = finalizeSite(
      initial,
      [
        {
          url: doorway,
          pageType: "landing",
          who01Status: null,
          bodyFingerprint: bodyShingleFingerprint(
            `${sharedBody} En Bilbao el festivo local es San Ignacio y el viernes de Aste Nagusia.`,
          ),
        },
        {
          url: sibling,
          pageType: "landing",
          who01Status: null,
          bodyFingerprint: bodyShingleFingerprint(
            `${sharedBody} En Donostia el festivo local es el Dia de San Sebastian y el 31 de julio.`,
          ),
        },
      ],
      facts,
    );
    expect(finding(finalized, "SPAM-02")?.status).toBe("fail");
    expect(finding(finalized, "SPAM-02")?.evidence).toContain("body overlap");
    expect(finalized.verdict).toBe("reject");
  });

  it("keeps a genuine catalog warn as warn when sampled siblings have distinct bodies", async () => {
    const facts = siteFacts();
    const initial = await evaluateSite({
      facts,
      languageJudge: failingJudge("SPAM-02"),
    });
    expect(finding(initial, "SPAM-02")?.status).toBe("warn");

    const finalized = finalizeSite(
      initial,
      [
        {
          url: doorway,
          pageType: "landing",
          who01Status: null,
          bodyFingerprint: bodyShingleFingerprint(
            "La fisiologia respiratoria estudia el intercambio gaseoso alveolar, los volumenes pulmonares dinamicos, la curva de disociacion de la hemoglobina y los mecanismos de regulacion acido base en pacientes criticos sometidos a ventilacion mecanica invasiva en unidades de cuidados intensivos hospitalarias.",
          ),
        },
        {
          url: sibling,
          pageType: "landing",
          who01Status: null,
          bodyFingerprint: bodyShingleFingerprint(
            "El procedimiento administrativo comun regula los plazos de subsanacion, los recursos de alzada y reposicion, el silencio administrativo positivo y negativo, la notificacion electronica obligatoria y la ejecucion forzosa de los actos dictados por las administraciones publicas espanolas segun la ley vigente.",
          ),
        },
      ],
      facts,
    );
    expect(finding(finalized, "SPAM-02")?.status).toBe("warn");
  });
});
