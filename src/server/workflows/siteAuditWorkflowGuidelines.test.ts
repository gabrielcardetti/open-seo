import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JudgedRule, RuleJudge } from "@/server/lib/guidelines/judge";
import type { PageEvaluation } from "@/server/lib/guidelines/page-evaluator";
import type { FetchedPage } from "@/server/lib/guidelines/page-fetch";
import type { SiteFacts } from "@/server/lib/guidelines/site-facts";
import type { GuidelinesStrategy } from "@/server/lib/audit/types";
import { emptySpamSignals } from "@/server/lib/guidelines/spam-signals";

const {
  pgStepMock,
  getSiteInventoryMock,
  insertEvaluationsMock,
  insertFailedEvaluationMock,
  getOutlinksMock,
  resolveJudgesMock,
} = vi.hoisted(() => ({
  pgStepMock: vi.fn(),
  getSiteInventoryMock: vi.fn(),
  insertEvaluationsMock:
    vi.fn<(rows: Array<{ evaluation: PageEvaluation }>) => Promise<void>>(),
  insertFailedEvaluationMock: vi.fn(),
  getOutlinksMock: vi.fn(),
  resolveJudgesMock: vi.fn(),
}));

vi.mock("@/server/workflows/pgStep", () => ({ pgStep: pgStepMock }));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: { updateAuditProgress: vi.fn() },
}));
vi.mock(
  "@/server/features/audit/repositories/GuidelineEvaluationRepository",
  () => ({
    GuidelineEvaluationRepository: {
      getSiteInventory: getSiteInventoryMock,
      insertEvaluations: insertEvaluationsMock,
      insertFailedEvaluation: insertFailedEvaluationMock,
    },
  }),
);
vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({ ProjectContextRepository: { listSections: async () => [] } }),
);
vi.mock("@/server/features/audit/AuditScratchpad", () => ({
  getAuditScratchpad: () => ({ getOutlinks: getOutlinksMock }),
}));
vi.mock("@/server/lib/guidelines/page-fetch", () => ({
  fetchPageForEvaluation: async (url: string) => fetchedPage(url),
}));
vi.mock("@/server/lib/guidelines/judge-config", () => ({
  resolveJudges: resolveJudgesMock,
}));

import { runGuidelinesPhase } from "@/server/workflows/siteAuditWorkflowGuidelines";

const ORIGIN = "https://example.com";
const SITE_URL = `${ORIGIN}/#site`;
const CITIES = [
  "madrid",
  "sevilla",
  "valencia",
  "bilbao",
  "malaga",
  "murcia",
  "cadiz",
  "leon",
  "soria",
];

// A city-swap doorway set: same title and slug with one word changed, and
// near-identical length. The homepage links to a contact page the crawl
// never reached.
const inventory = [
  { url: `${ORIGIN}/`, title: "Firma de abogados", wordCount: 900 },
  ...CITIES.map((city, i) => ({
    url: `${ORIGIN}/abogados-en-${city}`,
    title: `Abogados en ${city} | Firma`,
    wordCount: 430 + i,
  })),
].map((page, i) => ({
  ...page,
  id: `page-${i}`,
  statusCode: 200,
  fetchClass: "ok",
  isIndexable: true,
  contentHash: `hash-${i}`,
  crawlDepth: i === 0 ? 0 : 1,
}));

function fetchedPage(url: string): FetchedPage {
  return {
    url,
    finalUrl: url,
    statusCode: 200,
    title: "Abogados",
    metaDescription: "",
    canonical: null,
    robotsMeta: null,
    googlebotMeta: null,
    robotsHeader: null,
    h1s: [],
    wordCount: 430,
    bodyText: "Abogados con experiencia.",
    structuredData: [],
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: 5,
    externalLinks: 0,
    isHttps: true,
    spamSignals: emptySpamSignals(),
  };
}

/** Fails doorways on the site, citing every cluster; passes everything else. */
const judge: RuleJudge = {
  name: "llm",
  modelId: "stub-llm",
  async judge(input) {
    const clusters =
      input.kind === "site" ? input.site.clusters.map((c) => c.id) : [];
    return input.rules.map(
      (rule): JudgedRule =>
        rule.id === "SPAM-02" && clusters.length > 0
          ? { ruleId: rule.id, status: "fail", clusters, evidence: "C1" }
          : { ruleId: rule.id, status: "pass" },
    );
  },
};

const PARAMS = {
  auditId: "audit-1",
  workflowInstanceId: "workflow-1",
  projectId: "project-1",
  startUrl: `${ORIGIN}/`,
  config: {
    maxPages: 50,
    lighthouseStrategy: "none" as const,
    guidelinesStrategy: "all" as GuidelinesStrategy,
  },
  crawlCompleted: true,
};

// pgStep is mocked, so the opaque WorkflowStep object is never read.
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const run = (params = PARAMS) => runGuidelinesPhase({} as never, params);

/** The value a step returned, which is what its checkpoint stores. */
function stepResult<T>(name: string): Promise<T> {
  const index = pgStepMock.mock.calls.findIndex((call) => call[1] === name);
  const result: unknown = pgStepMock.mock.results[index]?.value;
  // The step bodies are the module's own; the mock only runs them.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return result as Promise<T>;
}

function stored(): PageEvaluation[] {
  return insertEvaluationsMock.mock.calls.flatMap(([rows]) =>
    rows.map((row) => row.evaluation),
  );
}

/**
 * Runs each step's body, one at a time: under Vitest, concurrent dynamic
 * imports of a mocked module (the page steps of a wave) can resolve to the
 * real one, which would fetch example.com and call a real judge.
 */
function runStepsInOrder(timedOutStep?: string) {
  let previous: Promise<unknown> = Promise.resolve();
  pgStepMock.mockImplementation(
    (_step: unknown, name: string, _config: unknown, fn: () => unknown) => {
      const current = previous.then(() => {
        if (name === timedOutStep) throw new Error("step timed out");
        return fn();
      });
      previous = current.catch(() => undefined);
      return current;
    },
  );
}

const finding = (evaluation: PageEvaluation | undefined, ruleId: string) =>
  evaluation?.findings.find((f) => f.ruleId === ruleId);

describe("runGuidelinesPhase site pass", () => {
  beforeEach(() => {
    runStepsInOrder();
    getSiteInventoryMock.mockResolvedValue(inventory);
    getOutlinksMock.mockResolvedValue([`${ORIGIN}/contacto`]);
    resolveJudgesMock.mockResolvedValue({
      decisionJudge: null,
      languageJudge: judge,
    });
  });

  it("rejects the doorway set on the site row and sends its pages back", async () => {
    await run();

    const site = stored().find((evaluation) => evaluation.url === SITE_URL);
    expect(site?.classification.pageType).toBe("site");
    expect(site?.verdict).toBe("reject");
    // The contact page is known only from the homepage's links.
    expect(finding(site, "EAT-06")).toBeUndefined();
    expect(insertEvaluationsMock).toHaveBeenLastCalledWith([
      expect.objectContaining({ pageId: null }),
    ]);

    const doorway = stored().find(
      (evaluation) => evaluation.url === `${ORIGIN}/abogados-en-madrid`,
    );
    // The city pages differ in text, so the site's answer sends each one back
    // for revision; only identical text would reject the page itself.
    expect(finding(doorway, "SPAM-02")).toMatchObject({
      status: "fail",
      severity: "high",
    });
    expect(doorway?.verdict).toBe("revise");
  });

  it("checkpoints cluster members only for the sampled pages", async () => {
    await run({
      ...PARAMS,
      config: { ...PARAMS.config, guidelinesStrategy: "sample" },
    });

    const sampled = await stepResult<Array<{ url: string }>>(
      "select-guidelines-sample",
    );
    const facts = await stepResult<SiteFacts>("guidelines-site-facts");
    // Sampled members, plus at most two per cluster for the flagged-cluster
    // pages the site pass may add.
    expect(sampled.length).toBeLessThan(inventory.length);
    for (const cluster of facts.clusters) {
      const unsampled = cluster.memberUrls.filter(
        (url) => !sampled.some((page) => page.url === url),
      );
      expect(unsampled.length).toBeLessThanOrEqual(2);
    }
  });

  // Doorway pages are short and the sampler takes each template's longest:
  // a flagged cluster must still get pages of its own judged.
  it("judges a couple of the flagged cluster's pages the sample missed", async () => {
    await run({
      ...PARAMS,
      config: { ...PARAMS.config, guidelinesStrategy: "sample" },
    });

    const sampled = await stepResult<Array<{ url: string }>>(
      "select-guidelines-sample",
    );
    const added = stored().filter(
      (evaluation) =>
        evaluation.url.includes("/abogados-en-") &&
        !sampled.some((page) => page.url === evaluation.url),
    );
    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThanOrEqual(2 * 2); // two clusters, two each
    for (const evaluation of added) {
      expect(finding(evaluation, "SPAM-02")).toMatchObject({ status: "fail" });
    }
  });

  it("builds the site row without homepage links when the scratchpad is gone", async () => {
    getOutlinksMock.mockRejectedValue(new Error("object reset"));

    await run();

    const site = stored().find((evaluation) => evaluation.url === SITE_URL);
    expect(finding(site, "EAT-06")).toMatchObject({ status: "fail" });
  });

  it("still judges the pages when the site judgement fails", async () => {
    runStepsInOrder("guidelines-site-eval");

    await run();

    expect(insertFailedEvaluationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: null,
        pageUrl: SITE_URL,
        pageType: "site",
      }),
    );
    expect(stored().map((evaluation) => evaluation.url)).toHaveLength(
      inventory.length,
    );
    expect(stored().some((evaluation) => evaluation.url === SITE_URL)).toBe(
      false,
    );
  });

  it("finishes the phase when the site row cannot be stored", async () => {
    runStepsInOrder("guidelines-site-persist");
    vi.spyOn(console, "error").mockReturnValue(undefined);

    await expect(run()).resolves.toBeUndefined();
    expect(stored()).toHaveLength(inventory.length);
  });
});
