import { chunk } from "remeda";
import { runBatch } from "@/db/runBatch";

type BatchExecutor = Parameters<Parameters<typeof runBatch>[0]>[0];

// D1 binds at most 100 parameters per statement. Leave room for the few values
// an upsert's SET clause binds on top of the rows.
const D1_MAX_PARAMS = 100;
const SET_CLAUSE_PARAMS = 8;
// Statements sent per D1 batch request (one Postgres transaction).
const STATEMENTS_PER_BATCH = 50;

/**
 * Write `rows` as multi-row statements sized to stay under D1's bound-parameter
 * limit, a bounded number of statements per batch. Each batch commits on its
 * own, so the statements must be idempotent upserts.
 */
export async function writeRowsInChunks<T extends Record<string, unknown>>(
  rows: T[],
  build: (tx: BatchExecutor, rows: T[]) => Promise<unknown>,
): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]).length;
  const rowsPerStatement = Math.max(
    1,
    Math.floor((D1_MAX_PARAMS - SET_CLAUSE_PARAMS) / columns),
  );
  const statements = chunk(rows, rowsPerStatement);
  for (const group of chunk(statements, STATEMENTS_PER_BATCH)) {
    await runBatch((tx) =>
      group.map((statementRows) => build(tx, statementRows)),
    );
  }
}
