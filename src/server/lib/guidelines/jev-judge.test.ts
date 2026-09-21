import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RULES_BY_ID } from "@/shared/guidelines/catalog";
import { UpstreamError, withRetry } from "@/server/lib/retry";
import {
  classifierDevTransport,
  workersAiTransport,
  type DecisionTransport,
} from "./decision-transport";
import { JevJudge } from "./jev-judge";
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

const binary = RULES_BY_ID.get("PF-W01")!;
const scored = RULES_BY_ID.get("PF-Q01")!;

const noSleep = { attempts: 4, baseDelayMs: 1, maxDelayMs: 50 };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("JevJudge", () => {
  // Unanswered is not a pass: it goes on to the second judge.
  it("records a rule the transport did not answer as unknown", async () => {
    const transport: DecisionTransport = {
      modelId: "fake",
      ask: () => Promise.resolve(new Map()),
    };
    const [result] = await new JevJudge(transport).judge({
      page,
      rules: [binary],
    });
    expect(result?.status).toBe("unknown");
  });

  it("stores a score 1-based from the transport's 0-based level", async () => {
    const transport: DecisionTransport = {
      modelId: "fake",
      ask: () =>
        Promise.resolve(new Map([[scored.id, { index: 4, confidence: 0.9 }]])),
    };
    const [result] = await new JevJudge(transport).judge({
      page,
      rules: [scored],
    });
    expect(result).toMatchObject({ status: "pass", score: 5 });
  });
});

describe("workersAiTransport", () => {
  // Unified billing rejects calls that bypass the authenticated gateway.
  it("routes every call through the configured gateway", async () => {
    const run = vi.fn().mockResolvedValue({ answers: {} });
    await workersAiTransport({ run }, "open-seo-selfhost", noSleep).ask(
      "state",
      [binary],
    );
    expect(run).toHaveBeenCalledWith("typesafe/jev", expect.anything(), {
      gateway: { id: "open-seo-selfhost" },
    });
  });

  it("sends score criteria as an ordered array", async () => {
    let sent: unknown;
    await workersAiTransport(
      {
        run: (_model: string, input: unknown) => {
          sent = input;
          return Promise.resolve({ answers: {} });
        },
      },
      "gw",
      noSleep,
    ).ask("state", [scored]);
    const parsed = z
      .object({
        questions: z.object({ PF_Q01: z.object({ criteria: z.unknown() }) }),
      })
      .parse(sent);
    expect(Array.isArray(parsed.questions.PF_Q01.criteria)).toBe(true);
  });

  // `noul` is P(failing condition) and carries no confidence of its own.
  it("reads a noul as a pass/fail label with a margin confidence", async () => {
    const run = vi.fn().mockResolvedValue({
      answers: { PF_W01: { type: "noul", noul: 0.95 } },
    });
    const answers = await workersAiTransport({ run }, "gw", noSleep).ask(
      "state",
      [binary],
    );
    expect(answers.get("PF-W01")?.label).toBe("fail");
    expect(answers.get("PF-W01")?.confidence).toBeCloseTo(0.9);
  });

  // Documented shape: 1.04 on a three-level scale is the second level.
  it("reads a score as a 0-based position", async () => {
    const run = vi.fn().mockResolvedValue({
      answers: { PF_Q01: { type: "score", score: 3.9, confidence: 0.8 } },
    });
    const answers = await workersAiTransport({ run }, "gw", noSleep).ask(
      "state",
      [scored],
    );
    expect(answers.get("PF-Q01")?.index).toBe(4);
  });

  it("does not retry a missing-balance refusal", async () => {
    const run = vi
      .fn()
      .mockRejectedValue(
        new Error("402: Insufficient balance; add money to your gateway"),
      );
    await expect(
      workersAiTransport({ run }, "gw", noSleep).ask("state", [binary]),
    ).rejects.toThrow("Insufficient balance");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("classifierDevTransport", () => {
  it("asks for one labelled dimension per rule, in batches of 20", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ results: [{ dimensions: {} }] })),
      );
    const rules = Array.from(RULES_BY_ID.values()).slice(0, 45);
    await classifierDevTransport({ fetchImpl, retry: noSleep }).ask(
      "state",
      rules,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps a score label back to its level", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            dimensions: {
              PF_Q01: {
                label: "original research or first-hand data",
                confidence: 0.7,
              },
            },
          },
        ],
      }),
    );
    const answers = await classifierDevTransport({
      fetchImpl,
      retry: noSleep,
    }).ask("state", [scored]);
    expect(answers.get("PF-Q01")).toEqual({ index: 4, confidence: 0.7 });
  });

  // The free tier is rate limited per caller; a 429 must wait and retry
  // rather than fail the page.
  it("retries a rate limit, honouring Retry-After", async () => {
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "0.02" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { dimensions: { PF_W01: { label: "pass", confidence: 0.9 } } },
          ],
        }),
      );
    const answers = await classifierDevTransport({
      fetchImpl,
      retry: {
        ...noSleep,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    }).ask("state", [binary]);
    expect(answers.get("PF-W01")?.label).toBe("pass");
    expect(waits).toEqual([20]);
  });

  it("gives up after the configured attempts", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("", { status: 503 })),
      );
    await expect(
      classifierDevTransport({ fetchImpl, retry: noSleep }).ask("state", [
        binary,
      ]),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry a malformed request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("too_few_labels", { status: 400 }));
    await expect(
      classifierDevTransport({ fetchImpl, retry: noSleep }).ask("state", [
        binary,
      ]),
    ).rejects.toThrow("400");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry", () => {
  it("caps a long Retry-After at the policy's maximum wait", async () => {
    const waits: number[] = [];
    let calls = 0;
    await withRetry(
      () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new UpstreamError("429", 429, 600_000));
        }
        return Promise.resolve("ok");
      },
      {
        attempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 20_000,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(waits).toEqual([20_000]);
  });
});
