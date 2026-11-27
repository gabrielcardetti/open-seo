/**
 * Compact body-text similarity sketch for corroborating doorway and
 * scaled-content clusters whose pages vary by more than 40 words.
 *
 * A real catalog (e.g. exam categories or products) shares navigation and a
 * template but differs in its own main content (~15-25% shingle Jaccard).
 * City-swap doorways or boilerplate calendars share 55-80% of their main body
 * even when their lengths differ by 60-150 words.
 *
 * Uses a deterministic bottom-k (k=64) sketch of 5-word normalized shingles
 * hashed with 32-bit FNV-1a: ~500 bytes per page, safe to pass across
 * Cloudflare Workflow step boundaries, and zero external dependencies.
 */
import { sort } from "remeda";
import { normalizeText } from "./site-skeleton";

const SHINGLE_SIZE = 5;
const SKETCH_SIZE = 64;
/** Pages with fewer shingles than this are too short for reliable overlap. */
const MIN_FINGERPRINT_SHINGLES = 16;

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/** Normalized word tokens from visible body text. */
function bodyTokens(bodyText: string): string[] {
  return normalizeText(bodyText)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0);
}

/**
 * Sorted bottom-k sketch of unique 5-word shingle hashes from `bodyText`.
 * Returns an empty array when the page has too few words to sketch.
 */
export function bodyShingleFingerprint(bodyText: string): number[] {
  const tokens = bodyTokens(bodyText);
  if (tokens.length < SHINGLE_SIZE) return [];

  const unique = new Set<number>();
  for (let i = 0; i <= tokens.length - SHINGLE_SIZE; i++) {
    const shingle = tokens.slice(i, i + SHINGLE_SIZE).join(" ");
    unique.add(fnv1a32(shingle));
  }
  if (unique.size < MIN_FINGERPRINT_SHINGLES) return [];

  return sort(Array.from(unique), (a, b) => a - b).slice(0, SKETCH_SIZE);
}

/**
 * Estimated Jaccard similarity (0..1) of two sorted bottom-k sketches.
 *
 * Under bottom-k estimation, the union of the two sets restricted to the
 * smallest `k = min(|A|, |B|)` hashes gives an unbiased Jaccard estimate:
 * `|A ∩ B ∩ U_k| / k`.
 */
export function jaccardOverlap(
  a: readonly number[],
  b: readonly number[],
): number | null {
  if (
    a.length < MIN_FINGERPRINT_SHINGLES ||
    b.length < MIN_FINGERPRINT_SHINGLES
  ) {
    return null;
  }
  const k = Math.min(a.length, b.length, SKETCH_SIZE);
  let i = 0;
  let j = 0;
  let seen = 0;
  let shared = 0;

  while (seen < k && (i < a.length || j < b.length)) {
    const av = i < a.length ? a[i] : Number.POSITIVE_INFINITY;
    const bv = j < b.length ? b[j] : Number.POSITIVE_INFINITY;
    if (av === bv) {
      shared += 1;
      i += 1;
      j += 1;
    } else if (av < bv) {
      i += 1;
    } else {
      j += 1;
    }
    seen += 1;
  }

  return seen === 0 ? null : Math.round((shared / seen) * 1000) / 1000;
}

interface ClusterBodyOverlap {
  medianOverlap: number;
  maxOverlap: number;
  pairs: number;
  sampledPages: number;
}

/** Pairwise body-shingle Jaccard overlap across sampled pages of a cluster. */
export function clusterBodyOverlap(
  members: readonly { url: string; fingerprint: readonly number[] }[],
): ClusterBodyOverlap | null {
  const usable = members
    .filter((m) => m.fingerprint.length >= MIN_FINGERPRINT_SHINGLES)
    .slice(0, 10);
  if (usable.length < 2) return null;

  const overlaps: number[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const score = jaccardOverlap(
        usable[i].fingerprint,
        usable[j].fingerprint,
      );
      if (score !== null) overlaps.push(score);
    }
  }
  if (overlaps.length === 0) return null;

  const sorted = sort(overlaps, (a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    medianOverlap: Math.round(median * 1000) / 1000,
    maxOverlap: sorted[sorted.length - 1],
    pairs: sorted.length,
    sampledPages: usable.length,
  };
}

/**
 * Thresholds at which body-shingle overlap corroborates a doorway or
 * scaled-content failure even when page lengths differ by >40 words.
 */
const CORROBORATED_MEDIAN_OVERLAP = 0.5;
const CORROBORATED_MAX_OVERLAP = 0.65;

export function findCorroboratingClusterOverlap(input: {
  citedClusterIds: readonly string[];
  clusters: ReadonlyArray<{
    id: string;
    size: number;
    memberUrls: readonly string[];
  }>;
  minClusterSize: number;
  fingerprints: ReadonlyMap<string, readonly number[]>;
}): { clusterId: string; overlap: ClusterBodyOverlap } | null {
  for (const clusterId of input.citedClusterIds) {
    const cluster = input.clusters.find((c) => c.id === clusterId);
    if (!cluster || cluster.size < input.minClusterSize) continue;
    const members = cluster.memberUrls.flatMap((url) => {
      const fp = input.fingerprints.get(url);
      return fp ? [{ url, fingerprint: fp }] : [];
    });
    const overlap = clusterBodyOverlap(members);
    if (
      overlap &&
      (overlap.medianOverlap >= CORROBORATED_MEDIAN_OVERLAP ||
        overlap.maxOverlap >= CORROBORATED_MAX_OVERLAP)
    ) {
      return { clusterId: cluster.id, overlap };
    }
  }
  return null;
}
