/**
 * Shared setup for the scale tests (tests/scale/*.scale.test.ts).
 *
 * A scale test is ONE rule checked on MANY cars. Each car is a separate test,
 * so a broken rule shows up as many failures, which Phase 4 groups by cause.
 *
 *   SCALE=quick (default, every push): a spread-out sample of the cars
 *   SCALE=full  (nightly): every car
 */
import type { FastifyInstance } from "fastify";
import { Agent } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { seed } from "../../data/generate";
import { buildApp } from "../../src/app";
import { openDb, type DB } from "../../src/db";
import { TEST_TOKEN } from "../helpers";

export const FULL = process.env.SCALE === "full";

export const auth = { authorization: `Bearer ${TEST_TOKEN}` };

/**
 * Real HTTP calls (supertest), reusing a few open connections. Without this,
 * every request opens a new connection on a new port, and thousands of
 * requests in a few seconds run the machine out of ports (EADDRNOTAVAIL):
 * failures caused by the test environment, not by the app.
 */
const keepAlive = new Agent({ keepAlive: true, maxSockets: 8 });
const target = (app: FastifyInstance) => {
  const address = app.server.address() as AddressInfo | null;
  return address ? `http://127.0.0.1:${address.port}` : app.server;
};
export const get = (app: FastifyInstance, url: string) => request(target(app)).get(url).agent(keepAlive);
export const post = (app: FastifyInstance, url: string, body: string | object, contentType = "application/json") =>
  request(target(app)).post(url).agent(keepAlive).set(auth).set("Content-Type", contentType).send(body);

/** The same synthetic market as data/centrale.db: same seed, same cars. */
export function seededDb(listings = 5000): DB {
  const db = openDb(":memory:");
  seed(db, { listings });
  return db;
}

/** Build the app and start it ONCE on a free port, so all requests share it. */
export async function appFor(db: DB): Promise<FastifyInstance> {
  const app = await buildApp({ db, apiToken: TEST_TOKEN });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return app;
}

/** In quick mode, keep `quickSize` items evenly spread over the list (so every kind of car is still covered). */
export function spread<T>(items: T[], quickSize: number): T[] {
  if (FULL || items.length <= quickSize) return items;
  const step = items.length / quickSize;
  return Array.from({ length: quickSize }, (_, i) => items[Math.floor(i * step)]);
}

export const versionName = (v: { id: number; brand: string; model: string; version: string }) =>
  `${v.brand} ${v.model} ${v.version} (v${v.id})`;
