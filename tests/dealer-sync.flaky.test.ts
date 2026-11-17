/**
 * Flaky test, on purpose: /dealer-sync/status depends on a simulated
 * unreliable upstream service, so this test sometimes fails with 503
 * although nothing in our code changed.
 *
 * It runs in the "allowed to fail" CI job. In Phase 4, QA Pilot's triage
 * reruns failures like this one to tell "flaky" apart from "real bug".
 */
import request from "supertest";
import { makeTestApp } from "./helpers";

describe("GET /dealer-sync/status", () => {
  it("returns the sync status of every dealer", async () => {
    const { app } = await makeTestApp();

    const res = await request(app.server).get("/dealer-sync/status");

    expect(res.status).toBe(200);
    expect(res.body.dealers).toHaveLength(3);
    await app.close();
  });
});
