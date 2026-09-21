import { describe, expect, it, vi } from "vitest";
import { RULES_BY_ID } from "@/shared/guidelines/catalog";
import { JevJudge, type AiBinding } from "./jev-judge";
import type { FetchedPage } from "./page-fetch";

const page: FetchedPage = {
  url: "https://example.com/a",
  finalUrl: "https://example.com/a",
  statusCode: 200,
  title: "A page",
  metaDescription: "",
  canonical: null,
  robotsMeta: null,
  h1s: ["A page"],
  wordCount: 300,
  bodyText: "Some content.",
  structuredData: [],
  imagesTotal: 0,
  imagesMissingAlt: 0,
  internalLinks: 1,
  externalLinks: 0,
  isHttps: true,
};

function judgeReturning(answers: Record<string, unknown>) {
  const run = vi.fn().mockResolvedValue({ model: "jev-1.13.0", answers });
  const ai: AiBinding = { run };
  return { run, judge: new JevJudge(ai, "open-seo-selfhost") };
}

describe("JevJudge", () => {
  // Unified billing rejects calls that bypass the authenticated gateway.
  it("routes every call through the configured gateway", async () => {
    const { run, judge } = judgeReturning({});
    await judge.judge({ page, rules: [RULES_BY_ID.get("PF-W01")!] });
    expect(run).toHaveBeenCalledWith("typesafe/jev", expect.anything(), {
      gateway: { id: "open-seo-selfhost" },
    });
  });

  it("sends score criteria as an ordered array", async () => {
    const { run, judge } = judgeReturning({});
    await judge.judge({ page, rules: [RULES_BY_ID.get("PF-Q01")!] });
    const input = run.mock.calls[0]![1] as {
      questions: Record<string, { criteria: unknown }>;
    };
    expect(Array.isArray(input.questions["PF_Q01"]!.criteria)).toBe(true);
  });

  // Score answers are 0-based and continuous (documented: 1.04 on a
  // three-level scale is the second level). Reading them as 1-based would
  // shift every graded rule down a notch.
  it("reads a score as a 0-based position on the scale", async () => {
    const { judge } = judgeReturning({
      PF_Q01: { type: "score", score: 3.9, confidence: 0.9 },
    });
    const [result] = await judge.judge({
      page,
      rules: [RULES_BY_ID.get("PF-Q01")!],
    });
    // 3.9 rounds to index 4, the top of five levels: a pass, stored as 5.
    expect(result).toMatchObject({ status: "pass", score: 5 });
  });

  it("fails a score at the bottom of the scale", async () => {
    const { judge } = judgeReturning({
      PF_Q01: { type: "score", score: 0.1, confidence: 0.9 },
    });
    const [result] = await judge.judge({
      page,
      rules: [RULES_BY_ID.get("PF-Q01")!],
    });
    expect(result).toMatchObject({ status: "fail", score: 1 });
  });

  // `noul` answers carry no confidence field; the margin from 0.5 stands in.
  it("treats a noul near 0.5 as a coin flip, not a verdict", async () => {
    const { judge } = judgeReturning({
      PF_W01: { type: "noul", noul: 0.55 },
    });
    const [result] = await judge.judge({
      page,
      rules: [RULES_BY_ID.get("PF-W01")!],
    });
    expect(result!.status).toBe("unknown");
  });

  it("fails a confident noul, which is the probability of the failing condition", async () => {
    const { judge } = judgeReturning({
      PF_W01: { type: "noul", noul: 0.97 },
    });
    const [result] = await judge.judge({
      page,
      rules: [RULES_BY_ID.get("PF-W01")!],
    });
    expect(result!.status).toBe("fail");
  });
});
