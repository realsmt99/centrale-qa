/**
 * Tests the auth hook on its own, using a tiny protected route.
 * Once Module 1 exists, the same checks also run against POST /feeds/import.
 */
import Fastify from "fastify";
import request from "supertest";
import { requireToken } from "../src/auth";
import { TEST_TOKEN } from "./helpers";

async function protectedApp() {
  const app = Fastify();
  app.post("/protected", { preHandler: requireToken(TEST_TOKEN) }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("requireToken", () => {
  it.each([
    ["no header", undefined],
    ["wrong token", "Bearer nope"],
    ["wrong scheme", `Basic ${TEST_TOKEN}`],
    ["empty bearer", "Bearer "],
  ])("rejects %s with 401", async (_label, header) => {
    const app = await protectedApp();
    const req = request(app.server).post("/protected");
    if (header) req.set("Authorization", header);

    const res = await req;

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    await app.close();
  });

  it("accepts the right token", async () => {
    const app = await protectedApp();

    const res = await request(app.server).post("/protected").set("Authorization", `Bearer ${TEST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    await app.close();
  });
});
