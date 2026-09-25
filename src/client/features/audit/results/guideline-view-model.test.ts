import { describe, expect, it } from "vitest";
import type {
  GuidelineEvaluationRow,
  GuidelineResultRow,
} from "./GuidelineEvaluationItem";
import {
  findingKind,
  groupByRule,
  isDecisionOnly,
  parseClusterEvidence,
} from "./guideline-view-model";

const finding = (
  overrides: Partial<GuidelineResultRow> = {},
): GuidelineResultRow => ({
  evaluationId: "e1",
  ruleId: "SPAM-02",
  status: "fail",
  severity: "high",
  evidence: "a quote",
  reason: null,
  remediation: null,
  confidence: null,
  ...overrides,
});

const evaluation = (id: string): GuidelineEvaluationRow => ({
  id,
  pageUrl: `https://example.com/${id}`,
  verdict: "revise",
  ymyl: false,
  pageType: "article",
  unknownCount: 0,
  judge: "mcp:sonnet-5",
  errorMessage: null,
});

describe("findingKind", () => {
  // What the reader is told decides whether they act on it: a lead the
  // pipeline could not confirm must never read as a failure.
  it.each([
    [finding(), "fail"],
    [finding({ evidence: "One of the pages in cluster C1. …" }), "site"],
    [
      finding({
        status: "warn",
        reason:
          "Flagged by the decision model; no second judge has confirmed it.",
      }),
      "unconfirmed",
    ],
    [
      finding({
        status: "warn",
        reason: "The judge's quote is not on the page; confirm before acting.",
      }),
      "unconfirmed",
    ],
    [finding({ status: "warn", reason: "Thin in places." }), "warning"],
  ] as const)("labels %j as %s", (row, kind) => {
    expect(findingKind(row)).toBe(kind);
  });
});

it("splits a site finding's anchored cluster prefix from the judge's words", () => {
  expect(
    parseClusterEvidence(
      '[clusters: C1, C3] C1: 10 pages /:slug "A {*}", words 1–2; C3: 8 pages /x "B {*}", words 3–4 — judge text',
    ),
  ).toEqual({
    clusterIds: ["C1", "C3"],
    clusterLines: [
      'C1: 10 pages /:slug "A {*}", words 1–2',
      'C3: 8 pages /x "B {*}", words 3–4',
    ],
    rest: "judge text",
  });
  expect(parseClusterEvidence("Nivel C2 en el título").clusterIds).toEqual([]);
});

it("groups findings by rule, most severe and most failing first", () => {
  const groups = groupByRule(
    [evaluation("a"), evaluation("b")],
    [
      finding({ evaluationId: "a", ruleId: "PF-Q01", severity: "high" }),
      finding({ evaluationId: "b", ruleId: "PF-Q01", severity: "high" }),
      finding({ evaluationId: "a", ruleId: "QRG-01", severity: "critical" }),
      finding({ evaluationId: "b", ruleId: "PF-E03", status: "unknown" }),
    ],
  );
  expect(groups.map((g) => [g.ruleId, g.fails])).toEqual([
    ["QRG-01", 1],
    ["PF-Q01", 2],
  ]);
});

it("treats only a judge that is all decision model as decision-only", () => {
  expect(isDecisionOnly("classifier.dev/jev")).toBe(true);
  expect(isDecisionOnly("classifier.dev/jev+openai/gpt-5.6-luna")).toBe(false);
  expect(isDecisionOnly("deterministic")).toBe(false);
});
