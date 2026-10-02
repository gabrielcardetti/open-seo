/**
 * An in-memory SQLite database with the real indexing, Bing and sitemap
 * registry migrations, for testing the indexing services against actual SQL.
 * Tests swap it in with
 *
 *   vi.mock("@/db", async () => ({ db: (await import("./indexing-test-db")).testDb }));
 *   vi.mock("@/db/runBatch", async () => ({
 *     executeInBatches: (await import("./indexing-test-db")).executeSequentially,
 *   }));
 */
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";

let database: DatabaseSync | null = null;

function toSqlValue(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  throw new Error("Unexpected SQL parameter");
}

export const testDb = drizzle(async (query, params, method) => {
  if (!database) throw new Error("Database not initialized");
  const statement = database.prepare(query);
  const values = params.map(toSqlValue);
  if (method === "run") {
    statement.run(...values);
    return { rows: [] };
  }
  const rows = statement.all(...values).map((row) => Object.values(row));
  return { rows: method === "get" ? (rows[0] ?? []) : rows };
});

/** A fresh database with one organization and project ("project-1"). */
export function resetTestDatabase() {
  database?.close();
  database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE user (id text PRIMARY KEY);
    CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('org-1');
    INSERT INTO projects VALUES ('project-1');
  `);
  database.exec(
    readFileSync("drizzle/sqlite/0053_cynical_roughhouse.sql", "utf8"),
  );
  database.exec(readFileSync("drizzle/sqlite/0054_fixed_midnight.sql", "utf8"));
}

/** Stand-in for runBatch's executeInBatches: one statement at a time. */
export async function executeSequentially<T>(
  items: T[],
  build: (tx: typeof testDb, item: T) => Promise<unknown>,
) {
  for (const item of items) await build(testDb, item);
}
