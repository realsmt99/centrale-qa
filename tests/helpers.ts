/**
 * Test helpers: every test gets its own fresh in-memory database,
 * so tests never depend on each other or on data/centrale.db.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { loadReferenceVersions, openDb } from "../src/db";

export const TEST_TOKEN = "test-token";
export const authHeader = { Authorization: `Bearer ${TEST_TOKEN}` };

/** Three dealers, enough for the import tests. */
export const TEST_DEALERS = ["D001", "D002", "D003"];

export async function makeTestApp() {
  const db = openDb(":memory:");
  loadReferenceVersions(db);
  const addDealer = db.prepare("INSERT INTO dealers (id, name, city) VALUES (?, ?, 'Paris')");
  for (const id of TEST_DEALERS) addDealer.run(id, `Test garage ${id}`);
  const app = await buildApp({ db, apiToken: TEST_TOKEN });
  return { app, db };
}

/** Read a sample feed from data/samples. */
export function sampleFeed(name: string): string {
  return readFileSync(join(__dirname, "..", "data", "samples", name), "utf8");
}
