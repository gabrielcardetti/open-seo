import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { UMAMI_MODES } from "@/shared/umami";
import { organization } from "./better-auth-schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Keep this definition structurally identical to ../umami.schema.ts.
export const umamiConnections = pgTable(
  "umami_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: UMAMI_MODES }).notNull(),
    baseUrl: text("base_url").notNull(),
    credentialEncrypted: text("credential_encrypted").notNull(),
    credentialHint: text("credential_hint").notNull(),
    websiteId: text("website_id"),
    websiteName: text("website_name"),
    websiteDomain: text("website_domain"),
    teamId: text("team_id"),
    connectedByUserId: text("connected_by_user_id").notNull(),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("umami_connections_project_idx").on(table.projectId),
    index("umami_connections_organization_idx").on(table.organizationId),
  ],
);
