/**
 * Title and slug skeletons: the shape a set of stamped-out pages share.
 *
 * "Abogados en Madrid | Firma" and "Abogados en Sevilla | Firma" differ in one
 * slot; "/mejor-crm-para-dentistas" and "/mejor-crm-para-abogados" likewise.
 * The crawl keeps no body fingerprint, so these skeletons (plus word-count
 * uniformity) are how the site pass sees near-identical pages at all.
 */
import { sort } from "remeda";

/** Lowercase and accent-free, so "Préstamos" and "prestamos" compare equal. */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function titleTokens(title: string): string[] {
  return title.split(/\s+/).filter(Boolean);
}

const SLOT = "{*}";

function isWord(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

export function wordStats(counts: readonly number[]): {
  medianWords: number;
  wordCv: number;
  wordRange: [number, number];
} {
  if (counts.length === 0) {
    return { medianWords: 0, wordCv: 0, wordRange: [0, 0] };
  }
  const sorted = sort(counts, (a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = counts.reduce((sum, n) => sum + n, 0) / counts.length;
  const variance =
    counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / counts.length;
  const cv = mean === 0 ? 0 : Math.sqrt(variance) / mean;
  return {
    medianWords: Math.round(median),
    wordCv: Math.round(cv * 100) / 100,
    wordRange: [sorted[0], sorted[sorted.length - 1]],
  };
}

/**
 * The title pattern of one URL template, for describing it ("{*} | Blog" on
 * 88% of pages). Tokens in at least 80% of titles are the skeleton; the rest
 * collapse into {*} slots. Descriptive only: clusters use `skeletonGroups`.
 */
export function templateTitleSkeleton(
  titles: readonly string[],
): { pattern: string; coverage: number } | null {
  if (titles.length < 3) return null;
  const tokenLists = titles.map(titleTokens);
  const docFrequency = new Map<string, number>();
  for (const tokens of tokenLists) {
    for (const token of new Set(tokens.map(normalizeText))) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }
  const threshold = titles.length * 0.8;
  const render = (tokens: string[]): string[] => {
    const out: string[] = [];
    for (const token of tokens) {
      const kept = (docFrequency.get(normalizeText(token)) ?? 0) >= threshold;
      const next = kept ? token : SLOT;
      if (next === SLOT && out.at(-1) === SLOT) continue;
      out.push(next);
    }
    return out;
  };

  const counts = new Map<string, { count: number; display: string }>();
  for (const tokens of tokenLists) {
    const rendered = render(tokens);
    const key = normalizeText(rendered.join(" "));
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { count: 1, display: rendered.join(" ") });
  }
  const [best] = sort(
    Array.from(counts, ([key, entry]) => ({ key, ...entry })),
    (a, b) => b.count - a.count || a.key.localeCompare(b.key),
  );
  const slots = best.key.split(" ").filter((token) => token === SLOT).length;
  const coverage = best.count / titles.length;
  if (slots < 1 || slots > 2 || coverage < 0.5) return null;
  return { pattern: best.display, coverage: Math.round(coverage * 100) / 100 };
}

/** A variable run longer than this is a different page, not a swapped slot. */
const MAX_SLOT_TOKENS = 3;

/**
 * Tokens of a title or slug that take part in a skeleton; the rest are
 * ignored. Long titles would otherwise cost quadratic work per page.
 */
const MAX_ITEM_TOKENS = 12;

export interface SkeletonItem {
  /** Keys only match within a scope (the parent path, for slugs). */
  scope: string;
  tokens: string[];
}

interface Candidate {
  key: string;
  members: number[];
  prefixLength: number;
  fixedCount: number;
}

/** 32-bit string hash (FNV-1a) with a per-lane seed. */
function hashText(text: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/** Folds one 32-bit value into a running hash (murmur3-style mixing). */
function mix(hash: number, value: number, multiplier: number): number {
  let h = Math.imul(hash ^ value, multiplier);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

const SLOT_HASH = hashText(SLOT, 0x811c9dc5);

/**
 * Groups of at least `minSize` items that are the same sequence of tokens with
 * one run of 1-3 tokens swapped out.
 *
 * Found across the whole site rather than per URL template: doorways often
 * share a template with ordinary pages (every root slug is `/:slug`), which
 * would dilute a per-template skeleton, and `/abogados/madrid` is not a
 * template at all to `detectUrlTemplate`. The fixed part must carry at least
 * two distinct words and outweigh the slot, so "{*} | Acme" (a brand suffix on
 * a varied catalog) is not a skeleton.
 *
 * Each item has up to 3 × 12 slot positions. Keeping a full-string key for
 * every one of them dominated memory on big crawls, so a first pass only counts
 * 53-bit hashes of the keys, and the exact string keys are built in a second
 * pass for the positions whose hash reached `minSize`. Hashes only prefilter:
 * a collision costs a string, never a wrong group. Measured on 10k titles of
 * 14 tokens, half of them doorways: ~0.4 s and ~45 MB of heap growth, against
 * ~0.8 s and ~115 MB with a string key per position and no token cap.
 */
export function skeletonGroups(
  items: readonly SkeletonItem[],
  joiner: string,
  minSize: number,
): Array<{ pattern: string; members: number[] }> {
  const tokenLists = items.map((item) => item.tokens.slice(0, MAX_ITEM_TOKENS));

  /** Calls `visit` with each slot position of an item that can be a skeleton. */
  const forEachSlot = (
    index: number,
    visit: (start: number, len: number, lower: string[], hash: number) => void,
  ) => {
    const lower = tokenLists[index].map(normalizeText);
    const words = lower.map(isWord);
    const n = lower.length;
    const scopeA = hashText(items[index].scope, 0x811c9dc5);
    const scopeB = hashText(items[index].scope, 0x9747b28c);
    const tokenA = lower.map((token) => hashText(token, 0x811c9dc5));
    const tokenB = lower.map((token) => hashText(token, 0x9747b28c));
    for (let start = 0; start < n; start++) {
      for (let len = 1; len <= MAX_SLOT_TOKENS && start + len <= n; len++) {
        const fixedCount = n - len;
        if (fixedCount < Math.max(2, len)) continue;
        const fixedWords = new Set<string>();
        let a = scopeA;
        let b = scopeB;
        for (let i = 0; i < n; i++) {
          if (i === start) {
            a = mix(a, SLOT_HASH, 0xcc9e2d51);
            b = mix(b, SLOT_HASH, 0x1b873593);
          }
          if (i >= start && i < start + len) continue;
          if (words[i]) fixedWords.add(lower[i]);
          a = mix(a, tokenA[i], 0xcc9e2d51);
          b = mix(b, tokenB[i], 0x1b873593);
        }
        if (fixedWords.size < 2) continue;
        visit(start, len, lower, a * 0x200000 + (b >>> 11));
      }
    }
  };

  const counts = new Map<number, number>();
  for (let index = 0; index < items.length; index++) {
    forEachSlot(index, (_start, _len, _lower, hash) => {
      counts.set(hash, (counts.get(hash) ?? 0) + 1);
    });
  }

  const candidates = new Map<string, Candidate>();
  for (let index = 0; index < items.length; index++) {
    forEachSlot(index, (start, len, lower, hash) => {
      if ((counts.get(hash) ?? 0) < minSize) return;
      const key = `${items[index].scope}\u0000${[...lower.slice(0, start), SLOT, ...lower.slice(start + len)].join(" ")}`;
      const candidate = candidates.get(key);
      if (!candidate) {
        candidates.set(key, {
          key,
          members: [index],
          prefixLength: start,
          fixedCount: lower.length - len,
        });
      } else if (candidate.members.at(-1) !== index) {
        candidate.members.push(index);
      }
    });
  }
  counts.clear();

  // Largest first; among equal sizes the most specific skeleton ("Abogados en
  // {*} | Firma" over "Abogados {*} | Firma"). Each item joins one group.
  const ranked = sort(
    Array.from(candidates.values()).filter((c) => c.members.length >= minSize),
    (a, b) =>
      b.members.length - a.members.length ||
      b.fixedCount - a.fixedCount ||
      a.key.localeCompare(b.key),
  );
  const claimed = new Set<number>();
  const groups: Array<{ pattern: string; members: number[] }> = [];
  for (const candidate of ranked) {
    const members = candidate.members.filter((index) => !claimed.has(index));
    if (members.length < minSize) continue;
    const suffixLength = candidate.fixedCount - candidate.prefixLength;
    const filling = (index: number): string => {
      const tokens = tokenLists[index];
      return normalizeText(
        tokens
          .slice(candidate.prefixLength, tokens.length - suffixLength)
          .join(" "),
      );
    };
    // Identical titles are a duplicate-title problem, not a skeleton.
    if (new Set(members.map(filling)).size < 2) continue;
    for (const index of members) claimed.add(index);
    const first = tokenLists[members[0]];
    const display = [
      ...first.slice(0, candidate.prefixLength),
      SLOT,
      ...first.slice(first.length - suffixLength),
    ].join(joiner);
    groups.push({ pattern: `${items[members[0]].scope}${display}`, members });
  }
  return groups;
}
