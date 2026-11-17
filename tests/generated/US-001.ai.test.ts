/**
 * AI-written tests for US-001, from approved cases on issue #7.
 * Written by mock (rule-based-v1). These PASSED on their first run, so they join the regression suite.
 * Review them like any other code before merging.
 */
import request from "supertest";
import { authHeader, makeTestApp, sampleFeed } from "../helpers";
import { registerPlate, sqlCheck } from "../qa-helpers";
import { loadSearchFixture } from "../search-fixture";

describe("AI-written tests", () => {
  it("TC-01 Valid request to GET /search succeeds", async () => {
    const { app, db } = await makeTestApp();
    loadSearchFixture(db);
    const res = await request(app.server).get("/search?brand=Peugeot");
    expect(res.status).toBe(200);
    await app.close();
  });

  it("TC-05 POST /feeds/import without a token is rejected", async () => {
    const { app, db } = await makeTestApp();
    const res = await request(app.server).post("/feeds/import?dealerId=D001").send({"cars":[{"externalRef":"REF-1001","versionId":2,"plate":"AB-123-CD","year":2022,"mileageKm":38000,"price":16900,"color":"gris"},{"externalRef":"REF-1002","versionId":9,"plate":"BC-234-DE","year":2023,"mileageKm":21000,"price":21500,"color":"blanc"}]});
    expect(res.status).toBe(401);
    expect(sqlCheck<{ n: number }>(db, "SELECT COUNT(*) AS n FROM listings")[0].n).toBe(0);
    await app.close();
  });

  it("TC-09 Data stored by POST /feeds/import matches what was sent", async () => {
    const { app, db } = await makeTestApp();
    expect((await request(app.server).post("/feeds/import?dealerId=D001").set(authHeader).send({"cars":[{"externalRef":"REF-1001","versionId":2,"plate":"AB-123-CD","year":2022,"mileageKm":38000,"price":16900,"color":"gris"},{"externalRef":"REF-1002","versionId":9,"plate":"BC-234-DE","year":2023,"mileageKm":21000,"price":21500,"color":"blanc"}]})).status).toBe(200);
    expect(sqlCheck(db, "SELECT version_id, year, mileage_km, price FROM listings WHERE dealer_id = 'D001' AND external_ref = ? AND status = 'active'", "REF-1001")).toEqual([{ version_id: 2, year: 2022, mileage_km: 38000, price: 16900 }]);
    expect(sqlCheck(db, "SELECT version_id, year, mileage_km, price FROM listings WHERE dealer_id = 'D001' AND external_ref = ? AND status = 'active'", "REF-1002")).toEqual([{ version_id: 9, year: 2023, mileage_km: 21000, price: 21500 }]);
    await app.close();
  });
});
