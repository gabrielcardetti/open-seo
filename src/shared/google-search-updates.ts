/**
 * Google Search updates: core and spam updates, policy changes, structured-data
 * retirements and other dated changes that can move a site's search traffic.
 *
 * `google-search-updates.json` is the `updates[]` ledger of
 * AgriciDaniel/claude-seo (MIT License, Copyright (c) 2026 agricidaniel),
 * where every entry cites a Google-owned page; its unverified, third-party-only
 * claims are left out. `last_verified` is the date that ledger was last checked
 * against Google's sources. Refresh it with `pnpm refresh:google-updates`.
 *
 * It is data, not code: the parse below catches a malformed refresh at module
 * load instead of in a chart or an MCP answer.
 */
import { z } from "zod";
import { sort } from "remeda";
import updatesJson from "./google-search-updates.json";

export const GOOGLE_UPDATE_KINDS = [
  "core",
  "spam",
  "core+spam",
  "policy",
  "qrg",
  "product",
  "schema",
  "cwv",
  "discover",
  "documentation",
] as const;

type GoogleUpdateKind = (typeof GOOGLE_UPDATE_KINDS)[number];

/** The kinds that re-rank results, which is what a traffic chart marks. */
export const RANKING_UPDATE_KINDS: readonly GoogleUpdateKind[] = [
  "core",
  "spam",
  "core+spam",
];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const googleSearchUpdateSchema = z.object({
  date: isoDate,
  name: z.string().min(1),
  kind: z.enum(GOOGLE_UPDATE_KINDS),
  source: z.url(),
  notes: z.string().optional(),
});

export type GoogleSearchUpdate = z.infer<typeof googleSearchUpdateSchema>;

export const googleSearchUpdatesFileSchema = z.object({
  source: z.url(),
  license: z.string().min(1),
  last_verified: isoDate,
  updates: z.array(googleSearchUpdateSchema),
});

const ledger = googleSearchUpdatesFileSchema.parse(updatesJson);

export const GOOGLE_UPDATES_LAST_VERIFIED = ledger.last_verified;

/** Oldest first. */
const GOOGLE_SEARCH_UPDATES = sort(ledger.updates, (a, b) =>
  a.date.localeCompare(b.date),
);

/** Updates announced between two YYYY-MM-DD dates (inclusive; either bound
 *  may be omitted), optionally limited to some kinds. */
export function googleSearchUpdatesBetween(
  startDate: string | undefined,
  endDate: string | undefined,
  kinds?: readonly GoogleUpdateKind[],
): GoogleSearchUpdate[] {
  return GOOGLE_SEARCH_UPDATES.filter(
    (update) =>
      (!startDate || update.date >= startDate) &&
      (!endDate || update.date <= endDate) &&
      (!kinds || kinds.includes(update.kind)),
  );
}
