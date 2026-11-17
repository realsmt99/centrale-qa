/**
 * AI chat (POST /chat): regression tests (must pass).
 *
 * Example listing: a 2024 Renault Clio E-Tech (hybrid, automatic), 30,000 km,
 * 18,600 EUR, sold by dealer D001 in Paris. Tests use the free template writer.
 */
import request from "supertest";
import { buildApp } from "../src/app";
import type { DB } from "../src/db";
import { loadReferenceVersions, openDb } from "../src/db";
import { TEST_TOKEN, authHeader, makeTestApp } from "./helpers";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

function addClio(db: DB): number {
  return Number(
    db
      .prepare(
        "INSERT INTO listings (dealer_id, external_ref, version_id, year, mileage_km, price, color) VALUES ('D001', 'CHAT-1', 9, 2024, 30000, 18600, 'blanc')",
      )
      .run().lastInsertRowid,
  );
}

describe("POST /chat", () => {
  let app: App;
  let listingId: number;
  const ask = (question: string, id = listingId) =>
    request(app.server).post("/chat").set(authHeader).send({ listingId: id, question });

  beforeEach(async () => {
    let db: DB;
    ({ app, db } = await makeTestApp());
    listingId = addClio(db);
  });
  afterEach(async () => {
    await app.close();
  });

  it("401 without a token", async () => {
    const res = await request(app.server).post("/chat").send({ listingId, question: "Quel est le prix ?" });

    expect(res.status).toBe(401);
  });

  it("answers from the car's data and returns those facts", async () => {
    const res = await ask("Quel est le kilométrage ?");

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("Elle affiche 30 000 km.");
    expect(res.body.facts).toMatchObject({ brand: "Renault", model: "Clio", year: 2024, city: "Paris", dealerName: "Test garage D001" });
    expect(res.body.writer).toEqual({ type: "template", model: "template-v1" });
  });

  it.each([
    ["Elle est de quelle année ?", "Elle est de 2024."],
    ["C'est une boîte automatique ?", "Motorisation : hybride, boîte automatique, 145 ch."],
    ["Elle a la clim ?", "Oui, elle a : climatisation."],
    ["Elle a un toit panoramique ?", "Non, elle n'a pas : toit panoramique."],
    ["Où peut-on la voir ?", "Elle se trouve à Paris, chez Test garage D001."],
  ])("%j -> %j", async (question, answer) => {
    expect((await ask(question)).body.answer).toBe(answer);
  });

  it("gives the price", async () => {
    expect((await ask("Quel est le prix ?")).body.answer).toContain("18 600 €");
  });

  it("says it doesn't know, instead of inventing", async () => {
    const res = await ask("A-t-elle déjà eu un accident ?");

    expect(res.body.answer).toContain("Je n'ai pas cette information");
    expect(res.body.answer).toContain("contactez le vendeur");
  });

  it("doesn't read 'ou' (or) as 'où' (where)", async () => {
    const res = await ask("Elle est manuelle ou automatique ?");

    expect(res.body.answer).not.toContain("Elle se trouve");
  });

  it("404 for a listing that doesn't exist", async () => {
    expect((await ask("Quel est le prix ?", 999)).status).toBe(404);
  });

  it.each([
    ["an empty question", ""],
    ["a question over 500 characters", "x".repeat(501)],
  ])("400 for %s", async (_label, question) => {
    expect((await ask(question)).status).toBe(400);
  });
});

it("502 when the chat writer is down, without leaking the error", async () => {
  const db = openDb();
  loadReferenceVersions(db);
  db.prepare("INSERT INTO dealers (id, name, city) VALUES ('D001', 'Garage', 'Paris')").run();
  const listingId = addClio(db);
  const app = await buildApp({
    db,
    apiToken: TEST_TOKEN,
    chatWriter: {
      type: "claude",
      model: "test",
      answer: async () => {
        throw new Error("secret upstream detail");
      },
    },
  });

  const res = await request(app.server).post("/chat").set(authHeader).send({ listingId, question: "Prix ?" });

  expect(res.status).toBe(502);
  expect(JSON.stringify(res.body)).not.toContain("secret upstream detail");
  await app.close();
});
