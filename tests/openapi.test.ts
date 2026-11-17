/**
 * openapi.json is what QA Pilot reads to design tests. If the API changes
 * and nobody regenerates the file, the AI would design tests for an API
 * that no longer exists. This test catches that.
 */
import { readFileSync } from "node:fs";
import { makeTestApp } from "./helpers";

it("openapi.json matches the running app (run `npm run openapi` if this fails)", async () => {
  const { app } = await makeTestApp();

  const live = JSON.parse(JSON.stringify(app.swagger()));
  const committed = JSON.parse(readFileSync("openapi.json", "utf8"));

  expect(committed).toEqual(live);
  await app.close();
});
