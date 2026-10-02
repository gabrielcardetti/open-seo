import { sort } from "remeda";
import type { BingAggregatedRow } from "@/server/features/bing/repositories/BingSnapshotRepository";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DateRangeInput = {
  startDate?: string;
  endDate?: string;
  /** The range's length when no dates are given. */
  days?: number;
};

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The caller's range, or the last `input.days` (else `days`) days ending at
 * the newest stored data (today when nothing is stored yet). Bing data lags and arrives in buckets,
 * so "the last 28 days" means the last 28 days we have, not the calendar.
 */
export function resolveRange(
  input: DateRangeInput,
  latestDate: string | null,
  days: number,
): { startDate: string; endDate: string } {
  const endDate =
    input.endDate ?? latestDate ?? new Date().toISOString().slice(0, 10);
  const startDate =
    input.startDate ?? addDays(endDate, -((input.days ?? days) - 1));
  return { startDate, endDate };
}

export function ctr(clicks: number, impressions: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

type Bucket = {
  key: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
};

/**
 * Collapse Bing's weekly buckets to one row per key, with the same weighting
 * the stored-history SQL uses: impression position weighted by impressions,
 * click position by clicks, each over the buckets that report one.
 */
export function aggregateBuckets(buckets: Bucket[]): BingAggregatedRow[] {
  const totals = new Map<
    string,
    {
      clicks: number;
      impressions: number;
      impressionWeight: number;
      impressionPositionSum: number;
      clickWeight: number;
      clickPositionSum: number;
    }
  >();
  for (const bucket of buckets) {
    const total = totals.get(bucket.key) ?? {
      clicks: 0,
      impressions: 0,
      impressionWeight: 0,
      impressionPositionSum: 0,
      clickWeight: 0,
      clickPositionSum: 0,
    };
    total.clicks += bucket.clicks;
    total.impressions += bucket.impressions;
    if (bucket.avgImpressionPosition !== null) {
      total.impressionWeight += bucket.impressions;
      total.impressionPositionSum +=
        bucket.avgImpressionPosition * bucket.impressions;
    }
    if (bucket.avgClickPosition !== null) {
      total.clickWeight += bucket.clicks;
      total.clickPositionSum += bucket.avgClickPosition * bucket.clicks;
    }
    totals.set(bucket.key, total);
  }
  const rows = Array.from(totals, ([key, total]) => ({
    key,
    clicks: total.clicks,
    impressions: total.impressions,
    avgImpressionPosition:
      total.impressionWeight > 0
        ? total.impressionPositionSum / total.impressionWeight
        : null,
    avgClickPosition:
      total.clickWeight > 0 ? total.clickPositionSum / total.clickWeight : null,
  }));
  return sort(
    rows,
    (a, b) => b.clicks - a.clicks || b.impressions - a.impressions,
  );
}
