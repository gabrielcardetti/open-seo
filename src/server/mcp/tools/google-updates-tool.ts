import { z } from "zod";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { formatMcpTable } from "@/server/mcp/table";
import {
  GOOGLE_UPDATE_KINDS,
  GOOGLE_UPDATES_LAST_VERIFIED,
  googleSearchUpdatesBetween,
} from "@/shared/google-search-updates";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const getGoogleSearchUpdatesTool = {
  name: "get_google_search_updates",
  config: {
    title: "Google Search updates",
    description:
      "Google's dated Search changes — core and spam updates, policy and Quality Rater Guidelines changes, structured-data retirements, Core Web Vitals and product changes — each with the Google page that announced it. Use it to tell whether a traffic or ranking change lines up with a Google update before blaming the site: ranking updates roll out over about two weeks after the announcement date. A curated ledger (from claude-seo, MIT), so the newest updates may be missing; the response says when it was last verified. Free — no project or credits needed.",
    inputSchema: {
      startDate: isoDate
        .optional()
        .describe("Only updates announced on or after this date (YYYY-MM-DD)."),
      endDate: isoDate
        .optional()
        .describe(
          "Only updates announced on or before this date (YYYY-MM-DD).",
        ),
      kinds: z
        .array(z.enum(GOOGLE_UPDATE_KINDS))
        .min(1)
        .optional()
        .describe(
          "Only these kinds. 'core', 'spam' and 'core+spam' are the ones that re-rank results. Default: every kind.",
        ),
    },
    outputSchema: z.looseObject({
      lastVerified: z.string(),
      updates: z.array(
        z.looseObject({
          date: z.string(),
          name: z.string(),
          kind: z.string(),
          source: z.string(),
          notes: z.string().optional(),
        }),
      ),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: (args: {
    startDate?: string;
    endDate?: string;
    kinds?: Array<(typeof GOOGLE_UPDATE_KINDS)[number]>;
  }) => {
    const updates = googleSearchUpdatesBetween(
      args.startDate,
      args.endDate,
      args.kinds,
    );
    const header = `Google Search updates (${updates.length}; ledger last verified ${GOOGLE_UPDATES_LAST_VERIFIED}):`;
    const table =
      updates.length === 0
        ? "None in this range."
        : formatMcpTable(updates, [
            { header: "date", value: (update) => update.date },
            { header: "kind", value: (update) => update.kind },
            { header: "name", value: (update) => update.name },
            { header: "notes", value: (update) => update.notes ?? "" },
            { header: "source", value: (update) => update.source },
          ]);
    return mcpResponse({
      text: `${header}\n${table}`,
      structuredContent: {
        lastVerified: GOOGLE_UPDATES_LAST_VERIFIED,
        updates,
      },
    });
  },
};
