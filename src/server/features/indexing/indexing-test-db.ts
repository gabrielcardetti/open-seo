/**
 * An in-memory SQLite database with the real indexing, Bing, sitemap
 * registry and URL inspection migrations, for testing the indexing services
 * against actual SQL.
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
    CREATE TABLE projects (id text PRIMARY KEY, archived_at text);
    CREATE TABLE gsc_connections (
      id text PRIMARY KEY, project_id text, organization_id text,
      site_url text, connected_by_user_id text, gsc_account_id text,
      connected_account_email text, created_at text, updated_at text
    );
    INSERT INTO organization VALUES ('org-1');
    INSERT INTO projects (id) VALUES ('project-1');
  `);
  for (const migration of [
    "0053_cynical_roughhouse",
    "0054_fixed_midnight",
    "0057_upstream_breakers",
    "0058_url_inspections",
  ]) {
    database.exec(readFileSync(`drizzle/sqlite/${migration}.sql`, "utf8"));
  }
}

/** Connect project-1 to a Search Console property. */
export function connectSearchConsole(siteUrl: string) {
  database
    ?.prepare(
      "INSERT INTO gsc_connections (id, project_id, organization_id, site_url, connected_by_user_id) VALUES ('gsc-1', 'project-1', 'org-1', ?, 'user-1')",
    )
    .run(siteUrl);
}

/** Stand-in for runBatch's executeInBatches: one statement at a time. */
export async function executeSequentially<T>(
  items: T[],
  build: (tx: typeof testDb, item: T) => Promise<unknown>,
) {
  for (const item of items) await build(testDb, item);
}
