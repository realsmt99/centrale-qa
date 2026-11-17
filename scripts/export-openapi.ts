/**
 * Writes the app's OpenAPI spec to openapi.json (run: npm run openapi).
 * QA Pilot reads this file to design tests. Committing it means a pull
 * request shows exactly how the API contract changed.
 */
import { writeFileSync } from "node:fs";
import { buildApp } from "../src/app";
import { openDb } from "../src/db";

async function main() {
  const app = await buildApp({ db: openDb(":memory:"), apiToken: "unused" });
  const spec = app.swagger();
  writeFileSync("openapi.json", JSON.stringify(spec, null, 2) + "\n");
  console.log(`Wrote openapi.json (${Object.keys(spec.paths ?? {}).length} paths)`);
  await app.close();
}

main();
