import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

/**
 * An in-memory SQLite database with the real Bing migration applied, for
 * tests that run the Bing repositories' SQL for real. Stub `projects` and
 * `user` tables stand in for the referenced tables; foreign keys are off so
 * tests seed only the rows they assert on.
 */
export async function createBingTestDb() {
  const client = createClient({ url: "file::memory:" });
  await client.executeMultiple(
    [
      "PRAGMA foreign_keys = OFF;",
      "CREATE TABLE projects (id text PRIMARY KEY, archived_at text);",
      "CREATE TABLE user (id text PRIMARY KEY, email text NOT NULL);",
      ...readFileSync("drizzle/sqlite/0053_cynical_roughhouse.sql", "utf8")
        .split("--> statement-breakpoint")
        .filter((statement) => statement.includes("bing_")),
    ].join("\n"),
  );
  return { client, db: drizzle(client) };
}

/** Empty every table between tests. */
export async function resetBingTestDb(
  client: Awaited<ReturnType<typeof createBingTestDb>>["client"],
) {
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  for (const { name } of tables.rows) {
    if (typeof name === "string") await client.execute(`DELETE FROM "${name}"`);
  }
}
