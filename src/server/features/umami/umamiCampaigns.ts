import { sort } from "remeda";

// UTM campaigns as Umami records them: per-field counts from the UTM report,
// and source / medium / campaign combinations parsed from the landing URLs'
// query strings.

export const UTM_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export type UtmField = (typeof UTM_FIELDS)[number];

export type CampaignTuple = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  count: number;
};

function utmValue(params: URLSearchParams, field: UtmField): string | null {
  return params.get(field)?.trim() || null;
}

/**
 * Source / medium / campaign combinations from Umami's query-string breakdown
 * (`metrics?type=query`, rows like `utm_source=app&utm_medium=card`). Query
 * strings without a UTM field are dropped; strings that differ only in other
 * parameters (a click id, a page number) count as one combination.
 */
export function campaignTuples(
  rows: Array<{ name: string; value: number }>,
  limit: number,
): CampaignTuple[] {
  const byKey = new Map<string, CampaignTuple>();
  for (const row of rows) {
    const params = new URLSearchParams(row.name.replace(/^\?/, ""));
    const tuple = {
      source: utmValue(params, "utm_source"),
      medium: utmValue(params, "utm_medium"),
      campaign: utmValue(params, "utm_campaign"),
      content: utmValue(params, "utm_content"),
      term: utmValue(params, "utm_term"),
    };
    if (Object.values(tuple).every((value) => value === null)) continue;
    const key = JSON.stringify(tuple);
    const existing = byKey.get(key);
    if (existing) existing.count += row.value;
    else byKey.set(key, { ...tuple, count: row.value });
  }
  return sort([...byKey.values()], (a, b) => b.count - a.count).slice(0, limit);
}
