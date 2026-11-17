/**
 * Price estimate (GET /pricing): regression tests (must pass).
 *
 * Example car used below: versionId 9 = Renault Clio E-Tech full hybrid 145,
 * new price 27,500 EUR, sold from 2020.
 */
import request from "supertest";
import type { DB } from "../src/db";
import { makeTestApp } from "./helpers";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

describe("GET /pricing", () => {
  let app: App;
  let db: DB;
  const price = async (versionId: number, year: number, km: number) =>
    (await request(app.server).get(`/pricing?versionId=${versionId}&year=${year}&mileageKm=${km}`)).body.estimatedPrice;

  beforeEach(async () => {
    ({ app, db } = await makeTestApp());
  });
  afterEach(async () => {
    await app.close();
  });

  it("gives a price, a range and how it was computed (no token needed)", async () => {
    const res = await request(app.server).get("/pricing?versionId=9&year=2024&mileageKm=30000");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      versionId: 9,
      year: 2024,
      mileageKm: 30000,
      estimatedPrice: 18600, // 27,500 x 0.72 (2 years old) x 0.94 (30,000 km)
      range: { low: 17100, high: 20100 }, // -8% / +8%
      basis: {
        newPrice: 27500,
        ageYears: 2,
        shareKept: 0.72,
        mileageFactor: 0.94,
        comparableListings: 0,
        marketAverage: null,
      },
    });
  });

  it("a brand-new car with 0 km is worth its new price", async () => {
    expect(await price(9, 2026, 0)).toBe(27500);
  });

  it("more kilometres -> lower price", async () => {
    expect(await price(9, 2024, 90000)).toBeLessThan(await price(9, 2024, 30000));
  });

  it("newer car -> higher price", async () => {
    expect(await price(9, 2024, 30000)).toBeGreaterThan(await price(9, 2023, 30000));
  });

  it("mileage above 300,000 km counts as 300,000", async () => {
    expect(await price(9, 2024, 400000)).toBe(await price(9, 2024, 300000));
  });

  it("shows the market: active listings of the same version and year, and their average", async () => {
    const add = db.prepare(
      "INSERT INTO listings (dealer_id, external_ref, version_id, year, mileage_km, price, status) VALUES ('D001', ?, 9, ?, 30000, ?, ?)",
    );
    add.run("M1", 2024, 18000, "active");
    add.run("M2", 2024, 19000, "active");
    add.run("M3", 2024, 5000, "sold"); // sold: ignored
    add.run("M4", 2023, 9000, "active"); // other year: ignored

    const res = await request(app.server).get("/pricing?versionId=9&year=2024&mileageKm=30000");

    expect(res.body.basis).toMatchObject({ comparableListings: 2, marketAverage: 18500 });
  });

  it("404 for a version that doesn't exist", async () => {
    const res = await request(app.server).get("/pricing?versionId=999&year=2024&mileageKm=30000");

    expect(res.status).toBe(404);
  });

  it.each([
    ["before the version was sold", 2, 2015, "sold from 2019 to 2026, not in 2015"],
    ["in the future", 9, 2027, "sold from 2020 to 2026, not in 2027"],
  ])("422 for a year %s", async (_label, versionId, year, message) => {
    const res = await request(app.server).get(`/pricing?versionId=${versionId}&year=${year}&mileageKm=30000`);

    expect(res.status).toBe(422);
    expect(res.body.message).toContain(message);
  });

  it.each([
    ["missing mileage", "versionId=9&year=2024"],
    ["negative mileage", "versionId=9&year=2024&mileageKm=-1"],
    ["a versionId that isn't a number", "versionId=abc&year=2024&mileageKm=30000"],
  ])("400 for %s", async (_label, query) => {
    const res = await request(app.server).get(`/pricing?${query}`);

    expect(res.status).toBe(400);
  });
});
