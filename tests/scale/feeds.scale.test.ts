/**
 * Stock import at scale.
 *
 * 1. DATA-DRIVEN: "re-importing the same feed changes nothing", for every way
 *    dealer software writes references (upper, lower, mixed case, extra
 *    spaces) and both formats (JSON, CSV).
 * 2. Boundaries: an empty feed means "I sold everything" (US-001 says the
 *    feed is the full stock). Invalid cars are refused, nothing is saved.
 * 3. SQL CONSISTENCY on the real 5,000-car site after a dealer re-sends its
 *    stock from another software (lower-case references).
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../../src/db";
import { makeTestApp } from "../helpers";
import { appFor, get, post, seededDb } from "./scale-helpers";

type Car = { externalRef: string; versionId: number; year: number; mileageKm: number; price: number; plate?: string };

const REF_STYLES: Record<string, (i: number) => string> = {
  upper: (i) => `REF-00${i}`,
  lower: (i) => `ref-00${i}`,
  mixed: (i) => `Ref-00${i}`,
  "extra spaces": (i) => ` REF-00${i} `,
};
const carsWith = (ref: (i: number) => string): Car[] =>
  [2, 9, 15, 21, 26].map((versionId, k) => ({ externalRef: ref(k + 1), versionId, year: 2022, mileageKm: 30_000 + k, price: 15_000 + k * 100 }));
const toCsv = (cars: Car[]) =>
  ["externalRef,versionId,year,mileageKm,price", ...cars.map((c) => [c.externalRef, c.versionId, c.year, c.mileageKm, c.price].join(","))].join("\n");

function importFeed(app: FastifyInstance, dealerId: string, cars: Car[], format: "json" | "csv") {
  const url = `/feeds/import?dealerId=${dealerId}`;
  return format === "json" ? post(app, url, { cars }) : post(app, url, toCsv(cars), "text/csv");
}
const activeCount = (db: DB, dealerId: string) =>
  (db.prepare("SELECT COUNT(*) AS n FROM listings WHERE dealer_id = ? AND status = 'active'").get(dealerId) as { n: number }).n;

const idempotencyCases = Object.keys(REF_STYLES).flatMap((style) =>
  (["json", "csv"] as const).map((format) => ({ style, format, label: `${style} references, ${format.toUpperCase()}` })),
);

describe("[feeds] Rule: re-importing the same feed changes nothing", () => {
  it.each(idempotencyCases)("$label", async ({ style, format }) => {
    const { app, db } = await makeTestApp();
    const cars = carsWith(REF_STYLES[style]);

    expect((await importFeed(app, "D001", cars, format)).body.created).toBe(5);
    const second = (await importFeed(app, "D001", cars, format)).body;

    expect(second).toMatchObject({ created: 0, unchanged: 5 });
    expect(activeCount(db, "D001")).toBe(5);
    await app.close();
  });
});

describe("[feeds] Rule: an empty feed means the dealer sold everything", () => {
  it.each(["json", "csv"] as const)("%s", async (format) => {
    const { app, db } = await makeTestApp();
    await importFeed(app, "D001", carsWith(REF_STYLES.upper), "json");

    const res = (await importFeed(app, "D001", [], format)).body;

    expect(res.markedSold).toBe(5);
    expect(activeCount(db, "D001")).toBe(0);
    await app.close();
  });
});

describe("[feeds] Rule: an invalid car is refused (400) and nothing is saved", () => {
  it.each([
    ["price of 0", { price: 0 }],
    ["negative price", { price: -1 }],
    ["year in the future", { year: new Date().getFullYear() + 2 }],
    ["negative mileage", { mileageKm: -1 }],
    ["unknown version", { versionId: 999 }],
    ["badly formatted plate", { plate: "AB123CD" }],
  ])("%s", async (_label, change) => {
    const { app, db } = await makeTestApp();
    const [first, ...rest] = carsWith(REF_STYLES.upper);

    const res = await importFeed(app, "D001", [{ ...first, ...change }, ...rest], "json");

    expect(res.status).toBe(400);
    expect(activeCount(db, "D001")).toBe(0);
    await app.close();
  });
});

describe("[feeds] SQL consistency after dealer D005 re-sends its stock with lower-case references", () => {
  const db = seededDb();
  let app: FastifyInstance;
  let before: number;

  beforeAll(async () => {
    app = await appFor(db);
    const stock = db
      .prepare("SELECT external_ref, version_id, year, mileage_km, price FROM listings WHERE dealer_id = 'D005' AND status = 'active'")
      .all() as { external_ref: string; version_id: number; year: number; mileage_km: number; price: number }[];
    before = stock.length;
    const cars = stock.map((r) => ({ externalRef: r.external_ref.toLowerCase(), versionId: r.version_id, year: r.year, mileageKm: r.mileage_km, price: r.price }));
    await importFeed(app, "D005", cars, "csv");
  });
  afterAll(async () => {
    await app.close();
  });

  it("no car is listed twice (dealer + reference is unique among active cars)", () => {
    const duplicates = db
      .prepare("SELECT dealer_id, external_ref, COUNT(*) AS n FROM listings WHERE status = 'active' GROUP BY dealer_id, external_ref HAVING n > 1")
      .all();
    expect(duplicates).toEqual([]);
  });

  it("the dealer still has the same number of active cars", () => {
    expect(activeCount(db, "D005")).toBe(before);
  });

  it("search shows exactly the active cars of the database", async () => {
    const total = (await get(app, "/search?pageSize=1")).body.total;
    const active = (db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'active'").get() as { n: number }).n;
    expect(total).toBe(active);
  });
});
