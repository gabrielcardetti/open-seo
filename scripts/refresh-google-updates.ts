import { writeFile } from "node:fs/promises";
import process from "node:process";
import { z } from "zod";
import { googleSearchUpdatesFileSchema } from "@/shared/google-search-updates";

/**
 * Refreshes src/shared/google-search-updates.json from the claude-seo ledger
 * (MIT). Only its verified `updates[]` are kept; the parse fails loudly when
 * upstream adds a kind or changes the shape, so new data never reaches the app
 * unchecked. Review the diff before committing.
 *
 * Usage: pnpm refresh:google-updates
 */
const SOURCE =
  "https://github.com/AgriciDaniel/claude-seo/blob/main/data/google-updates.json";
const RAW =
  "https://raw.githubusercontent.com/AgriciDaniel/claude-seo/main/data/google-updates.json";
const OUTPUT = new URL(
  "../src/shared/google-search-updates.json",
  import.meta.url,
);

const response = await fetch(RAW);
if (!response.ok) {
  console.error(`Fetching ${RAW} failed: ${response.status}`);
  process.exit(1);
}
const upstream = z
  .object({ last_verified: z.string(), updates: z.array(z.unknown()) })
  .parse(await response.json());

const ledger = googleSearchUpdatesFileSchema.parse({
  source: SOURCE,
  license: "MIT License, Copyright (c) 2026 agricidaniel",
  last_verified: upstream.last_verified,
  updates: upstream.updates,
});

await writeFile(OUTPUT, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(
  `Wrote ${ledger.updates.length} updates, last verified ${ledger.last_verified}.`,
);
