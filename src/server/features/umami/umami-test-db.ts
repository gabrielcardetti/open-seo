import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

/**
 * An in-memory SQLite database with the real Umami migration applied, for
 * tests that run the Umami repository's SQL for real. Stub `user` and
 * `projects` tables stand in for the connector join and the project domain; foreign keys are off so tests seed only
 * the rows they assert on.
 */
export async function createUmamiTestDb() {
  const client = createClient({ url: "file::memory:" });
  await client.executeMultiple(
    [
      "PRAGMA foreign_keys = OFF;",
      "CREATE TABLE user (id text PRIMARY KEY, email text NOT NULL);",
      "CREATE TABLE projects (id text PRIMARY KEY, organization_id text, name text, domain text, location_code integer, language_code text, ai_research_keywords text, created_at text, archived_at text);",
      readFileSync("drizzle/sqlite/0055_umami_connections.sql", "utf8"),
    ].join("\n"),
  );
  return { client, db: drizzle(client) };
}
