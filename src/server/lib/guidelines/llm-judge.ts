/**
 * Language-model judge: the pass that produces findings a person can act on.
 *
 * It answers the rules a decision model flagged or could not settle, and its
 * job is as much the quote and the sentence as the verdict — a `fail` with no
 * evidence is an accusation, not a finding.
 *
 * Two shape decisions worth knowing:
 *
 * - it speaks plain chat-completions over `fetch`, with a configurable base
 *   URL, so the same code runs against OpenRouter, xAI or any compatible
 *   endpoint. The AI SDK is in the repo but earns its weight in SAM, which
 *   needs streaming, tools and a turn loop; this is one request returning one
 *   JSON object, and the audit worker's bundle is kept deliberately lean.
 * - it returns ONLY the rules that do not pass. Anything unmentioned is a pass.
 *   Output tokens are the expensive half of a language model, and most rules
 *   pass on most pages, so saying nothing about them is the saving.
 */
import { z } from "zod";
import { RULES_BY_ID, type GuidelineRule } from "@/shared/guidelines/catalog";
import {
  renderSubject,
  type JudgeInput,
  type JudgedRule,
  type RuleJudge,
} from "./judge";

const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Conduct rules, taken from the research pack's evaluator prompt. The load-
 * bearing ones are 1 (the catalog is the only authority), 3 (quote or it did
 * not happen) and 4 (missing data is `unknown`, never a guess).
 */
const SYSTEM_PROMPT = `You evaluate a web page against the official Google Search quality guidelines supplied in the request.

1. Invent no policies. If a rule is not in the supplied list, it does not exist.
2. Evaluate; do not rewrite the page.
3. Quote a short piece of the page's own text as evidence for every fail or warn.
4. If the data needed to decide is missing, use status "unknown". Never guess.
5. A page's reason for existing cannot be "to rank".
6. Using AI is not a violation. Producing scaled content with no original value is. Never fail a page just because AI was used; judge effort, originality and value.
7. Trust is the most important dimension of E-E-A-T.
8. On Your Money or Your Life topics the bar is higher: an easily checked factual error is a serious failure.
9. Never recommend llms.txt, content chunking, word-count targets, faking dates, or manufacturing mentions.
10. Some rules ask about a pattern across many pages (doorways, scaled content, one URL per query variant) or about why a page was made. You see one page: fail them only when this page itself shows it, otherwise answer "unknown".
11. Most rules are advice, not requirements. A page type that does not call for something (a category page without a byline, a listing without first-hand experience) passes that rule.

Return ONLY the rules that do NOT pass. Any rule you do not mention counts as a pass.
Answer with a JSON object: {"findings":[{"id":"RULE-ID","status":"fail"|"warn"|"unknown","evidence":"short quote","reason":"one sentence"}]}`;

/**
 * The same conduct for a whole site, judged from its crawl inventory. The
 * load-bearing additions are the catalog clause (the false positive that
 * matters on templated sites) and the cluster citation, which the corroboration
 * guard in site-evaluator.ts checks against the cluster's real shape.
 */
const SITE_SYSTEM_PROMPT = `You evaluate a whole website against the official Google Search quality guidelines supplied in the request. You see its crawl inventory, not page text: URL templates, clusters of pages that share a title or URL skeleton or identical text (C1, C2, ...), and a sample of titles.

1. Invent no policies. If a rule is not in the supplied list, it does not exist.
2. Evidence is the inventory's own words: quote URLs, titles, title patterns or cluster ids exactly, separated by "; ". Cite every cluster a finding rests on in "clusters".
3. Templated catalogs of genuinely different items — products, listings, recipes, people, places with their own content — are NOT doorways or scaled content. A pattern is a problem when the pages differ only in a swapped word (a city, a keyword variant) and exist to catch each query.
4. If the inventory cannot show the answer, use status "unknown". Never guess; titles do not show a page's quality.
5. Using AI is not a violation. Producing many pages with no original value is.
6. Never recommend llms.txt, content chunking, word-count targets, faking dates, or manufacturing mentions.

Return ONLY the rules that do NOT pass. Any rule you do not mention counts as a pass.
Answer with a JSON object: {"findings":[{"id":"RULE-ID","status":"fail"|"warn"|"unknown","clusters":["C1"],"evidence":"quoted URLs or titles","reason":"one sentence"}]}`;

const findingSchema = z.object({
  id: z.string(),
  status: z.enum(["fail", "warn", "unknown"]),
  evidence: z.string().optional(),
  reason: z.string().optional(),
  score: z.number().optional(),
  clusters: z.array(z.string()).optional(),
});

const responseSchema = z.object({
  findings: z.array(findingSchema).default([]),
});

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().nullish(),
            reasoning: z.string().nullish(),
          })
          .optional(),
      }),
    )
    .optional(),
});

interface LlmJudgeConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Sent by OpenRouter-style gateways for attribution; harmless elsewhere. */
  referer?: string;
  maxOutputTokens?: number;
}

function rulesBlock(rules: readonly GuidelineRule[]): string {
  return rules
    .map(
      (rule) =>
        `${rule.id} [${rule.severity}] ${rule.question} | PASS IF: ${rule.pass_if} | FAIL IF: ${rule.fail_if}`,
    )
    .join("\n");
}

/** Pull the JSON object out of a reply that may be wrapped in prose or fences. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export class LlmJudge implements RuleJudge {
  readonly name = "llm" as const;
  readonly modelId: string;

  constructor(private readonly config: LlmJudgeConfig) {
    this.modelId = config.model;
  }

  async judge(input: JudgeInput): Promise<JudgedRule[]> {
    const { rules } = input;
    if (rules.length === 0) return [];
    const isSite = input.kind === "site";

    const body = {
      model: this.config.model,
      temperature: 0,
      max_tokens: this.config.maxOutputTokens ?? 4000,
      response_format: { type: "json_object" as const },
      messages: [
        {
          role: "system" as const,
          content: isSite ? SITE_SYSTEM_PROMPT : SYSTEM_PROMPT,
        },
        {
          role: "user" as const,
          content: `=== RULES ===\n${rulesBlock(rules)}\n\n=== ${isSite ? "SITE" : "PAGE"} ===\n${renderSubject(input)}`,
        },
      ],
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.config.referer) headers["HTTP-Referer"] = this.config.referer;

    const response = await fetch(
      `${this.config.baseUrl ?? DEFAULT_LLM_BASE_URL}/chat/completions`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Judge model returned ${response.status}: ${detail.slice(0, 200)}`,
      );
    }

    // The gateway's envelope, validated rather than asserted: a provider that
    // answers with an error body must not read as an empty set of findings.
    const envelope = chatCompletionSchema.safeParse(await response.json());
    if (!envelope.success) {
      throw new Error("Judge model returned an unreadable response envelope");
    }
    const message = envelope.data.choices?.[0]?.message;
    const text = message?.content ?? message?.reasoning ?? "";
    const parsed = responseSchema.safeParse(extractJson(text));
    if (!parsed.success) {
      throw new Error("Judge model returned an unreadable answer");
    }

    const asked = new Set(rules.map((rule) => rule.id));
    const results: JudgedRule[] = [];
    const reported = new Set<string>();

    for (const finding of parsed.data.findings) {
      // A verdict on a rule that was not asked is discarded: the model may not
      // widen the evaluation past the set the catalog selected for this page.
      if (!asked.has(finding.id) || !RULES_BY_ID.has(finding.id)) continue;
      if (reported.has(finding.id)) continue;
      reported.add(finding.id);
      results.push({
        ruleId: finding.id,
        status: finding.status,
        score: finding.score ?? null,
        confidence: null,
        evidence: finding.evidence?.trim() || null,
        reason: finding.reason?.trim() || null,
        ...(finding.clusters?.length ? { clusters: finding.clusters } : {}),
      });
    }

    // Silence is the pass signal, so the unmentioned rules are filled in here
    // rather than being lost.
    for (const rule of rules) {
      if (!reported.has(rule.id)) {
        results.push({
          ruleId: rule.id,
          status: "pass",
          confidence: null,
          evidence: null,
          reason: null,
        });
      }
    }

    return results;
  }
}
