/**
 * Helpers available to AI-written tests (tests/generated/).
 *
 * AI-written tests may READ the database, never write to it directly.
 * sqlCheck() is their only door to the DB, and it asks SQLite itself
 * whether the statement is read-only before running it.
 */
import type { DB } from "../src/db";

export function sqlCheck<T = Record<string, unknown>>(db: DB, sql: string, ...params: unknown[]): T[] {
  const stmt = db.prepare(sql);
  if (!stmt.readonly || !stmt.reader) {
    throw new Error(`sqlCheck only runs read-only SELECT statements. Refused: ${sql}`);
  }
  return stmt.all(...params) as T[];
}

/** Test-data helper: put a plate in the simulated registry, using a catalogue version's data. */
export function registerPlate(db: DB, plate: string, versionId: number, firstRegistration: string): void {
  db.prepare(`
    INSERT INTO plates (plate, brand, model, fuel, power_hp, first_registration)
    SELECT ?, brand, model, fuel, power_hp, ? FROM versions WHERE id = ?`).run(plate, firstRegistration, versionId);
}
