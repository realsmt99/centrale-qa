/**
 * AI chat at scale: answers must say only true things (US-004).
 *
 * 1. Price question: the answer gives the price and NEVER an offer that isn't
 *    in the data (financing, credit, discount, warranty).
 * 2. Gearbox question: the gearbox in the answer matches the database.
 * 3. Sold cars: cars sold the normal way (the dealer's next feed no longer
 *    lists them) must get 410, not answers.
 * Quick mode: 500 listings spread over the 5,000. Nightly: all 5,000.
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../../src/db";
import { formatFr, mentionedGearbox } from "../../src/listing-writer";
import { appFor, post, seededDb, spread } from "./scale-helpers";

const OFFER = /financement|crédit|credit|\bLOA\b|\bLLD\b|€\/mois|mensualit|remise|réduction|garantie/i;

const db = seededDb();
const listingIds = (db.prepare("SELECT id FROM listings ORDER BY id").all() as { id: number }[]).map((r) => r.id);
const cases = spread(listingIds, 500).map((id) => ({ id }));

const ask = (app: FastifyInstance, listingId: number, question: string) => post(app, "/chat", { listingId, question });

let app: FastifyInstance;
beforeAll(async () => {
  app = await appFor(db);
});
afterAll(async () => {
  await app.close();
});

describe("[chat] Rule: a price answer gives the price and never invents an offer", () => {
  it.each(cases)("listing $id", async ({ id }) => {
    const body = (await ask(app, id, "Quel est le prix ?")).body;

    expect(body.answer).toContain(`${formatFr(body.facts.price)} €`);
    expect(body.answer).not.toMatch(OFFER);
  });
});

describe("[chat] Rule: the gearbox in the answer matches the database", () => {
  it.each(cases)("listing $id", async ({ id }) => {
    const body = (await ask(app, id, "Elle est automatique ou manuelle ?")).body;

    expect(mentionedGearbox(body.answer)).toBe(body.facts.gearbox);
  });
});

describe("[chat] Rule: a sold car is not discussed anymore (410)", () => {
  // A separate copy of the site: dealer D007 sends a feed without 20 of its cars, so they become sold.
  const soldDb: DB = seededDb();
  const stock = soldDb
    .prepare("SELECT id, external_ref, version_id, year, mileage_km, price FROM listings WHERE dealer_id = 'D007' AND status = 'active' ORDER BY id")
    .all() as { id: number; external_ref: string; version_id: number; year: number; mileage_km: number; price: number }[];
  const sold = stock.slice(0, 20);
  let soldApp: FastifyInstance;

  beforeAll(async () => {
    soldApp = await appFor(soldDb);
    const kept = stock.slice(20).map((r) => ({ externalRef: r.external_ref, versionId: r.version_id, year: r.year, mileageKm: r.mileage_km, price: r.price }));
    const res = await post(soldApp, "/feeds/import?dealerId=D007", { cars: kept });
    expect(res.body.markedSold).toBe(20);
  });
  afterAll(async () => {
    await soldApp.close();
  });

  it.each(sold.map((r) => ({ id: r.id })))("sold listing $id", async ({ id }) => {
    const res = await ask(soldApp, id, "Elle est toujours disponible ?");

    expect(res.status).toBe(410);
  });
});
