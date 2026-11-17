/** Starts Mini La Centrale on http://localhost:3000 (API docs at /docs). */
import { buildApp } from "./app";
import { loadReferenceVersions, openDb } from "./db";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "data/centrale.db";
const API_TOKEN = process.env.API_TOKEN ?? "dev-token";

async function main() {
  const db = openDb(DB_PATH);
  loadReferenceVersions(db);
  const app = await buildApp({ db, apiToken: API_TOKEN, logger: true, docsUi: true });
  await app.listen({ port: PORT, host: "127.0.0.1" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
