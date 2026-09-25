import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CATALOG_VERSION } from "@/shared/guidelines/catalog";
import type { FetchedPage } from "@/server/lib/guidelines/page-fetch";
import type { PageEvaluation } from "@/server/lib/guidelines/page-evaluator";
import { emptySpamSignals } from "@/server/lib/guidelines/spam-signals";
import {
  getGuidelinesEvaluationBatchTool,
  submitGuidelinesEvaluationTool,
} from "./guideline-judge-tools";
import { makeToolContext } from "./tool-test-support";

const ORIGIN = "https://example.com";
const SITE = `${ORIGIN}/#site`;
const CITIES = ["madrid", "sevilla", "valencia", "bilbao", "malaga"];
const MORE = ["murcia", "zaragoza", "cadiz", "leon", "soria"];
const DOORWAY = `${ORIGIN}/abogados-en-madrid`;

const siteItemSchema = z.object({
  site: z.object({
    url: z.string(),
    rule_ids: z.array(z.string()),
    content: z.string(),
  }),
});

// Ten city-swap pages of the same length: a doorway cluster by any measure.
const inventory = [...CITIES, ...MORE].map((city, index) => ({
  id: `page_${index}`,
  url: `${ORIGIN}/abogados-en-${city}`,
  statusCode: 200,
  fetchClass: "ok",
  isIndexable: true,
  title: `Abogados en ${city[0].toUpperCase()}${city.slice(1)} | Firma`,
  wordCount: 430,
  contentHash: `hash_${index}`,
  crawlDepth: 1,
}));

// Crawled 10 of a 50-page limit: the crawl ran out of pages, not budget.
const audit = {
  id: "audit_1",
  startUrl: `${ORIGIN}/`,
  status: "completed",
  config: JSON.stringify({ maxPages: 50, lighthouseStrategy: "none" }),
  pagesCrawled: inventory.length,
};

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getAuditForProject: vi.fn(),
  getPagesForAudit: vi.fn(),
  getJudgedUrls: vi.fn(),
  getSiteInventory: vi.fn(),
  getSiteEvaluation: vi.fn(),
  getResultsForRules: vi.fn(),
  getEvaluationsForAudit: vi.fn(),
  getIssuesForAudit: vi.fn(),
  insertEvaluations:
    vi.fn<
      (
        inputs: Array<{ pageId: string | null; evaluation: PageEvaluation }>,
      ) => Promise<void>
    >(),
  listSections: vi.fn(),
  fetchPageForEvaluation: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: mocks,
}));
vi.mock(
  "@/server/features/audit/repositories/GuidelineEvaluationRepository",
  () => ({ GuidelineEvaluationRepository: mocks }),
);
vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({ ProjectContextRepository: mocks }),
);
vi.mock("@/server/lib/guidelines/page-fetch", () => ({
  fetchPageForEvaluation: mocks.fetchPageForEvaluation,
}));

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

beforeEach(() => {
  mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  mocks.getAuditForProject.mockResolvedValue(audit);
  mocks.getPagesForAudit.mockResolvedValue(inventory);
  mocks.getJudgedUrls.mockResolvedValue(new Set());
  mocks.getSiteInventory.mockResolvedValue(inventory);
  mocks.getSiteEvaluation.mockResolvedValue(null);
  mocks.getResultsForRules.mockResolvedValue([]);
  mocks.getEvaluationsForAudit.mockResolvedValue([]);
  mocks.getIssuesForAudit.mockResolvedValue([]);
  mocks.listSections.mockResolvedValue([]);
  mocks.fetchPageForEvaluation.mockImplementation((url: string) =>
    Promise.resolve(fetchedPage(url)),
  );
});

const batchArgs = (overrides: { limit?: number; urls?: string[] } = {}) => ({
  projectId: "project_1",
  auditId: "audit_1",
  limit: 1,
  strategy: "sample" as const,
  ...overrides,
});

const siteContent = async () =>
  siteItemSchema.parse(
    (
      await getGuidelinesEvaluationBatchTool.handler(
        batchArgs({ urls: [SITE] }),
        makeToolContext(),
      )
    ).structuredContent,
  ).site.content;

describe("get_guidelines_evaluation_batch", () => {
  it("hands out the whole-site item until a model has judged the site", async () => {
    const batch = await getGuidelinesEvaluationBatchTool.handler(
      batchArgs({ urls: [SITE] }),
      makeToolContext(),
    );
    const { site } = siteItemSchema.parse(batch.structuredContent);
    expect(site.url).toBe(SITE);
    expect(site.rule_ids).toContain("SPAM-02");
    expect(site.content).toContain("C1");

    mocks.getJudgedUrls.mockResolvedValue(new Set([SITE]));
    const judged = await getGuidelinesEvaluationBatchTool.handler(
      batchArgs({ urls: [SITE] }),
      makeToolContext(),
    );
    expect(judged.structuredContent).not.toHaveProperty("site");
  });

  it("hands back one page per identical body, as the workflow samples", async () => {
    mocks.getSiteInventory.mockResolvedValue(
      inventory.map((page) => ({ ...page, contentHash: "same" })),
    );
    const batch = await getGuidelinesEvaluationBatchTool.handler(
      batchArgs({ limit: 10 }),
      makeToolContext(),
    );
    expect(batch.structuredContent?.pages).toHaveLength(1);
  });

  it("reads the crawl as complete only when it finished short of its page limit", async () => {
    expect(await siteContent()).toContain("CRAWL COMPLETE: yes");

    mocks.getIssuesForAudit.mockResolvedValue([{ id: "rate_limited" }]);
    expect(await siteContent()).toContain("CRAWL COMPLETE: no");

    mocks.getIssuesForAudit.mockResolvedValue([]);
    mocks.getAuditForProject.mockResolvedValue({ ...audit, pagesCrawled: 50 });
    expect(await siteContent()).toContain("CRAWL COMPLETE: no");
  });
});

/** Three evaluated articles with no WHO-01 finding. */
const articles = (catalogVersion: string) =>
  [1, 2, 3].map((n) => ({
    id: `evaluation_${n}`,
    pageType: "article",
    errorMessage: null,
    catalogVersion,
    ymyl: false,
    aiSuspected: false,
  }));

describe("submit_guidelines_evaluation", () => {
  // The point of the site pass: a doorway page looks fine on its own, and the
  // site finding on its cluster is what flags it, over MCP as in the workflow.
  it("stores the site under its sentinel and flags a page of the doorway cluster it failed", async () => {
    const result = await submitGuidelinesEvaluationTool.handler(
      {
        projectId: "project_1",
        auditId: "audit_1",
        judgeModel: "sonnet-5",
        results: [
          { url: DOORWAY, findings: [] },
          {
            url: SITE,
            findings: [
              { ruleId: "SPAM-02", status: "fail", clusters: ["C1"] },
              { ruleId: "PF-Q01", status: "fail" },
            ],
          },
        ],
      },
      makeToolContext(),
    );

    expect(result.structuredContent?.rejected).toEqual([
      `${SITE}: PF-Q01 was not asked for the site`,
    ]);
    const [site, page] = mocks.insertEvaluations.mock.calls[0][0];
    expect(site).toMatchObject({
      pageId: null,
      evaluation: { url: SITE, verdict: "reject", judge: "mcp:sonnet-5" },
    });
    // Distinct texts: the page is sent back, the site row rejects.
    expect(page.evaluation.verdict).toBe("revise");
    expect(
      page.evaluation.findings.find((f) => f.ruleId === "SPAM-02"),
    ).toMatchObject({ status: "fail", severity: "high" });
  });

  // SITE-04 is read off the pages' bylines. Only non-passing rules are
  // stored, so a page with no WHO-01 row passed it only if WHO-01 applied.
  it("settles real authors only from pages that were asked WHO-01", async () => {
    const siteAuthors = async () => {
      await submitGuidelinesEvaluationTool.handler(
        {
          projectId: "project_1",
          auditId: "audit_1",
          results: [{ url: SITE, findings: [] }],
        },
        makeToolContext(),
      );
      const [site] = mocks.insertEvaluations.mock.lastCall?.[0] ?? [];
      return site?.evaluation.findings.find((f) => f.ruleId === "SITE-04");
    };

    mocks.getEvaluationsForAudit.mockResolvedValue(articles(CATALOG_VERSION));
    expect(await siteAuthors()).toBeUndefined();

    mocks.getEvaluationsForAudit.mockResolvedValue(articles("0.0.0"));
    expect(await siteAuthors()).toMatchObject({ status: "unknown" });
  });
});
