import request from "supertest";
import { makeTestApp } from "./helpers";

describe("GET /health", () => {
  it("returns ok and the size of the reference catalogue", async () => {
    const { app } = await makeTestApp();

    const res = await request(app.server).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", versions: 41, listings: 0 });
    await app.close();
  });

  it("publishes an OpenAPI spec (QA Pilot reads it in Phase 2)", async () => {
    const { app } = await makeTestApp();

    const res = await request(app.server).get("/openapi.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths).toHaveProperty("/health");
    expect(res.body.paths).not.toHaveProperty("/openapi.json");
    await app.close();
  });
});
