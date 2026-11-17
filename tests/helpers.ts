/**
 * Test helpers: every test gets its own fresh in-memory database,
 * so tests never depend on each other or on data/centrale.db.
 */
import { buildApp } from "../src/app";
import { loadReferenceVersions, openDb } from "../src/db";

export const TEST_TOKEN = "test-token";
export const authHeader = { Authorization: `Bearer ${TEST_TOKEN}` };

export async function makeTestApp() {
  const db = openDb(":memory:");
  loadReferenceVersions(db);
  const app = await buildApp({ db, apiToken: TEST_TOKEN });
  return { app, db };
}
