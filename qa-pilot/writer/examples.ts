/**
 * One known-good request per endpoint, like the examples saved in a Postman
 * collection. The writer (AI or mock) starts from these and changes one
 * thing per test, so tests don't fail because of made-up test data.
 */
export interface RequestExample {
  method: "GET" | "POST";
  /** Path with params filled in, query string included. */
  url: string;
  auth: boolean;
  body?: Record<string, unknown>;
  /** Code to run before the call (uses only the allowed helpers). */
  setup?: string;
}

export const REQUEST_EXAMPLES: Record<string, RequestExample> = {
  "GET /health": { method: "GET", url: "/health", auth: false },
  "POST /feeds/import": {
    method: "POST",
    url: "/feeds/import?dealerId=D001",
    auth: true,
    body: {
      cars: [
        { externalRef: "REF-1001", versionId: 2, plate: "AB-123-CD", year: 2022, mileageKm: 38000, price: 16900, color: "gris" },
        { externalRef: "REF-1002", versionId: 9, plate: "BC-234-DE", year: 2023, mileageKm: 21000, price: 21500, color: "blanc" },
      ],
    },
  },
  "GET /vehicles/{plate}": {
    method: "GET",
    url: "/vehicles/BC-234-DE",
    auth: false,
    setup: `registerPlate(db, "BC-234-DE", 9, "2023-03-01"); // Renault Clio E-Tech full hybrid 145`,
  },
  "GET /search": {
    method: "GET",
    url: "/search?brand=Peugeot",
    auth: false,
    setup: "loadSearchFixture(db);",
  },
  "GET /dealer-sync/status": { method: "GET", url: "/dealer-sync/status", auth: false },
};

/** The fixed header of every generated file. The AI never writes imports. */
export const GENERATED_HEADER = `import request from "supertest";
import { authHeader, makeTestApp, sampleFeed } from "../helpers";
import { registerPlate, sqlCheck } from "../qa-helpers";
import { loadSearchFixture } from "../search-fixture";`;

/** What generated tests are allowed to use, explained to the AI. */
export const HELPERS_DOC = `Available in every test (already imported, do not import anything):
- const { app, db } = await makeTestApp();  // fresh app + empty in-memory DB (versions catalogue and dealers D001, D002, D003 loaded). Always end with: await app.close();
- request(app.server)  // supertest: .get(url) / .post(url).set(authHeader).send(body)
- authHeader           // { Authorization: "Bearer <valid test token>" }
- sampleFeed(name)     // text of data/samples/<name>: "D001-stock-day1.json", "D001-stock-day2.json", "D002-stock.csv"
- loadSearchFixture(db) // inserts 8 known listings for search tests (cheapest active: 13900; one sold car at 8900)
- registerPlate(db, plate, versionId, "YYYY-MM-DD") // registers a plate in the registry (e.g. versionId 9 = Renault Clio E-Tech 145)
- sqlCheck(db, sql, ...params) // runs ONE read-only SELECT and returns rows. The only allowed way to read the DB.
Forbidden: imports, require, db.prepare/db.exec (use sqlCheck), file system, process, network calls other than request(app.server), .only/.skip, describe blocks.`;
