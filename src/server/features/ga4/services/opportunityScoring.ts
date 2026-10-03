// Shared by the Google Analytics and Umami search opportunity reads, so both
// rank pages with the same formula.

export const OPPORTUNITY_SCORE_FORMULA =
  "round(100 * (0.5 * demand + 0.3 * businessValue + 0.2 * reachability))";

/** host[:port]/path without a trailing slash; null for "(not set)" or junk. */
export function normalizePageKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "(not set)") return null;
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    let host = url.hostname.toLowerCase();
    const defaultPort =
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443");
    if (url.port && !defaultPort) host += `:${url.port}`;
    let path = url.pathname || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function percentileRanks(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [1];
  return values.map((value) => {
    const lower = values.filter((candidate) => candidate < value).length;
    return lower / (values.length - 1);
  });
}

function roundComponent(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Score pages ranking 4–20 against each other: demand (log impressions),
 * business value (the analytics source's outcome rate) and reachability
 * (how close the page is to the top), each as a percentile rank.
 */
export function scoreOpportunities(
  items: Array<{
    impressions: number;
    position: number;
    businessValue: number;
  }>,
) {
  const demand = percentileRanks(
    items.map((item) => Math.log1p(item.impressions)),
  );
  const businessValue = percentileRanks(
    items.map((item) => item.businessValue),
  );
  const reachability = percentileRanks(items.map((item) => 20 - item.position));
  return items.map((_, index) => {
    const scoreComponents = {
      demand: roundComponent(demand[index] ?? 0),
      businessValue: roundComponent(businessValue[index] ?? 0),
      reachability: roundComponent(reachability[index] ?? 0),
    };
    return {
      scoreComponents,
      score: Math.round(
        100 *
          (0.5 * scoreComponents.demand +
            0.3 * scoreComponents.businessValue +
            0.2 * scoreComponents.reachability),
      ),
    };
  });
}
