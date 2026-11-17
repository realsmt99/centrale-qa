/**
 * Module 1: stock import, bug-hunt tests.
 *
 * These describe how the import SHOULD behave. They are expected to fail
 * while a known bug exists, so CI runs them in a separate job that is
 * allowed to fail (see .github/workflows/ci.yml).
 */
import request from "supertest";
import { authHeader, makeTestApp } from "./helpers";

const car = (overrides: object = {}) => ({
  externalRef: "REF-9001",
  versionId: 2,
  year: 2022,
  mileageKm: 30000,
  price: 15000,
  ...overrides,
});

describe("POST /feeds/import: business rules on price and year", () => {
  it.each([
    ["a negative price", { price: -500 }],
    ["a price of zero", { price: 0 }],
    ["a year in the future", { year: new Date().getFullYear() + 2 }],
  ])("rejects %s with 400", async (_label, overrides) => {
    const { app, db } = await makeTestApp();

    const res = await request(app.server)
      .post("/feeds/import?dealerId=D001")
      .set(authHeader)
      .send({ cars: [car(overrides)] });

    expect(res.status).toBe(400);
    expect((db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n).toBe(0);
    await app.close();
  });
});
