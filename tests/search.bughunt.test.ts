/**
 * Module 3: search, bug-hunt tests (run in the "allowed to fail" CI job).
 *
 * Data-driven: the same rule is checked for every fuel type.
 * Rule: a fuel filter returns ONLY cars with exactly that fuel.
 */
import request from "supertest";
import { FUELS } from "../src/search";
import { makeTestApp } from "./helpers";
import { loadSearchFixture } from "./search-fixture";

describe("GET /search: fuel filter is exact", () => {
  it.each(FUELS)("fuel=%s returns only cars with exactly that fuel", async (fuel) => {
    const { app, db } = await makeTestApp();
    loadSearchFixture(db);

    const res = await request(app.server).get(`/search?fuel=${fuel}&pageSize=100`);

    expect(res.status).toBe(200);
    const wrongFuel = res.body.results.filter((r: { fuel: string }) => r.fuel !== fuel);
    expect(wrongFuel).toEqual([]);
    await app.close();
  });
});
