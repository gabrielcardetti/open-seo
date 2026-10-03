import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { UMAMI_MODES } from "@/shared/umami";
import { organization } from "./better-auth-schema";

// The Umami instance and website a project reads its analytics from. Unlike a
// Google grant, an Umami credential belongs to the project: a Cloud API key or
// a self-hosted login, sealed with secretBox. Reads are live (Umami keeps the
// full history), so there are no snapshot tables.
export const umamiConnections = sqliteTable(
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
    // API origin: https://api.umami.is/v1 for Cloud, the instance origin plus
    // /api for self-hosted (validated against the SSRF policy when saved).
    baseUrl: text("base_url").notNull(),
    // Ciphertext of JSON {apiKey} (cloud) or {username, password} (self-hosted).
    credentialEncrypted: text("credential_encrypted").notNull(),
    // What the UI may show: the key's last four characters, or the username.
    credentialHint: text("credential_hint").notNull(),
    // Null until a website is chosen; the project counts as connected after.
    websiteId: text("website_id"),
    websiteName: text("website_name"),
    websiteDomain: text("website_domain"),
    teamId: text("team_id"),
    connectedByUserId: text("connected_by_user_id").notNull(),
    // The last read Umami refused (bad credentials, website gone); cleared when
    // the connection is saved again.
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("umami_connections_project_idx").on(table.projectId),
    index("umami_connections_organization_idx").on(table.organizationId),
  ],
);
