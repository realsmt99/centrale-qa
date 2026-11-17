/**
 * Module 1: stock import, regression tests (must pass).
 *
 * Story used in these tests:
 *   day 1: dealer D001 sends 5 cars
 *   day 2: REF-1003 was sold, REF-1004 got cheaper, REF-1006 arrived
 */
import request from "supertest";
import type { DB } from "../src/db";
import { authHeader, makeTestApp, sampleFeed } from "./helpers";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

function importJson(app: App, dealerId: string, body: string | object) {
  return request(app.server)
    .post(`/feeds/import?dealerId=${dealerId}`)
    .set(authHeader)
    .set("Content-Type", "application/json")
    .send(typeof body === "string" ? body : JSON.stringify(body));
}

function importCsv(app: App, dealerId: string, csv: string) {
  return request(app.server)
    .post(`/feeds/import?dealerId=${dealerId}`)
    .set(authHeader)
    .set("Content-Type", "text/csv")
    .send(csv);
}

const countListings = (db: DB, where = "1=1") =>
  (db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${where}`).get() as { n: number }).n;

const car = (overrides: object = {}) => ({
  externalRef: "REF-9001",
  versionId: 2,
  year: 2022,
  mileageKm: 30000,
  price: 15000,
  ...overrides,
});

describe("POST /feeds/import", () => {
  let app: App;
  let db: DB;

  beforeEach(async () => {
    ({ app, db } = await makeTestApp());
  });
  afterEach(async () => {
    await app.close();
  });

  describe("auth", () => {
    it("rejects a request without a token (401), before reading the body", async () => {
      const res = await request(app.server)
        .post("/feeds/import?dealerId=D001")
        .set("Content-Type", "application/json")
        .send("{ not even valid json");

      expect(res.status).toBe(401);
      expect(countListings(db)).toBe(0);
    });
  });

  describe("happy path", () => {
    it("creates every car on the first import", async () => {
      const res = await importJson(app, "D001", sampleFeed("D001-stock-day1.json"));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        dealerId: "D001", received: 5, created: 5, updated: 0, unchanged: 0, markedSold: 0,
      });
      expect(countListings(db, "dealer_id = 'D001' AND status = 'active'")).toBe(5);
    });

    it("on the next day: creates new cars, updates prices and marks missing cars as sold", async () => {
      await importJson(app, "D001", sampleFeed("D001-stock-day1.json"));

      const res = await importJson(app, "D001", sampleFeed("D001-stock-day2.json"));

      expect(res.body).toEqual({
        dealerId: "D001", received: 5, created: 1, updated: 1, unchanged: 3, markedSold: 1,
      });
      // SQL checks: the database matches what the API said
      const ref1003 = db.prepare("SELECT status FROM listings WHERE external_ref = 'REF-1003'").get();
      const ref1004 = db.prepare("SELECT price FROM listings WHERE external_ref = 'REF-1004'").get();
      expect(ref1003).toEqual({ status: "sold" });
      expect(ref1004).toEqual({ price: 16900 });
      expect(countListings(db, "dealer_id = 'D001' AND status = 'active'")).toBe(5);
    });

    it("re-importing the same file changes nothing", async () => {
      await importJson(app, "D001", sampleFeed("D001-stock-day1.json"));

      const res = await importJson(app, "D001", sampleFeed("D001-stock-day1.json"));

      expect(res.body).toMatchObject({ created: 0, updated: 0, unchanged: 5, markedSold: 0 });
      expect(countListings(db)).toBe(5);
    });

    it("imports a CSV feed", async () => {
      const res = await importCsv(app, "D002", sampleFeed("D002-stock.csv"));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ dealerId: "D002", received: 4, created: 4 });
      const first = db
        .prepare("SELECT version_id, year, mileage_km, price FROM listings WHERE external_ref = 'VO-2024-001'")
        .get();
      expect(first).toEqual({ version_id: 5, year: 2021, mileage_km: 61000, price: 22900 });
    });

    it("one dealer's import never touches another dealer's cars", async () => {
      await importJson(app, "D001", sampleFeed("D001-stock-day1.json"));

      await importCsv(app, "D002", sampleFeed("D002-stock.csv"));

      expect(countListings(db, "dealer_id = 'D001' AND status = 'active'")).toBe(5);
    });
  });

  describe("rejected feeds (nothing is saved)", () => {
    it("404 for an unknown dealer", async () => {
      const res = await importJson(app, "D999", { cars: [car()] });

      expect(res.status).toBe(404);
      expect(countListings(db)).toBe(0);
    });

    it("400 when a versionId is not in the catalogue", async () => {
      const res = await importJson(app, "D001", { cars: [car(), car({ externalRef: "REF-9002", versionId: 999 })] });

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([999]);
      expect(countListings(db)).toBe(0);
    });

    it("400 when the same car appears twice in one feed", async () => {
      const res = await importJson(app, "D001", { cars: [car(), car({ externalRef: " ref-9001 " })] });

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(["REF-9001"]);
    });

    it.each([
      ["negative mileage", { mileageKm: -1 }],
      ["missing price", { price: undefined }],
      ["year before 1990", { year: 1985 }],
      ["badly formatted plate", { plate: "AB123CD" }],
    ])("400 for %s", async (_label, overrides) => {
      const res = await importJson(app, "D001", { cars: [car(overrides)] });

      expect(res.status).toBe(400);
      expect(countListings(db)).toBe(0);
    });

    it("400 for a CSV with an unknown column", async () => {
      const res = await importCsv(app, "D001", "externalRef,versionId,colour\nREF-1,2,red\n");

      expect(res.status).toBe(400);
    });
  });

  describe("SQL consistency", () => {
    it("never has two active listings for the same (dealer, externalRef)", async () => {
      await importJson(app, "D001", sampleFeed("D001-stock-day1.json"));
      await importJson(app, "D001", sampleFeed("D001-stock-day2.json"));
      await importCsv(app, "D002", sampleFeed("D002-stock.csv"));

      const duplicates = db
        .prepare(`
          SELECT dealer_id, external_ref, COUNT(*) AS n FROM listings
          WHERE status = 'active'
          GROUP BY dealer_id, external_ref HAVING n > 1`)
        .all();
      expect(duplicates).toEqual([]);
    });
  });
});
