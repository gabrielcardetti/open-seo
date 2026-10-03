import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

/**
 * An in-memory SQLite database with the real Umami migration applied, for
 * tests that run the Umami repository's SQL for real. A stub `user` table
 * stands in for the connector join; foreign keys are off so tests seed only
 * the rows they assert on.
 */
export async function createUmamiTestDb() {
  const client = createClient({ url: "file::memory:" });
  await client.executeMultiple(
    [
      "PRAGMA foreign_keys = OFF;",
      "CREATE TABLE user (id text PRIMARY KEY, email text NOT NULL);",
      readFileSync("drizzle/sqlite/0055_umami_connections.sql", "utf8"),
    ].join("\n"),
  );
  return { client, db: drizzle(client) };
}
