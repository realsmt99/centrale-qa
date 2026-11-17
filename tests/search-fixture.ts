/**
 * A small, hand-made market: 8 cars, so every expected search result
 * can be checked by eye.
 */
import type { DB } from "../src/db";

export const FIXTURE = [
  //  ref  dealer  versionId  (what it is)                   year  km      price   status
  { ref: "S1", dealer: "D001", versionId: 2, year: 2022, km: 38000, price: 16900, status: "active" }, // Peugeot 208 petrol
  { ref: "S2", dealer: "D001", versionId: 3, year: 2021, km: 60000, price: 13900, status: "active" }, // Peugeot 208 diesel
  { ref: "S3", dealer: "D001", versionId: 9, year: 2023, km: 21000, price: 21500, status: "active" }, // Renault Clio hybrid
  { ref: "S4", dealer: "D002", versionId: 21, year: 2020, km: 98000, price: 17400, status: "active" }, // VW Golf diesel
  { ref: "S5", dealer: "D002", versionId: 35, year: 2022, km: 40000, price: 39900, status: "active" }, // Mercedes Classe C diesel_hybrid
  { ref: "S6", dealer: "D002", versionId: 30, year: 2023, km: 41000, price: 29900, status: "active" }, // Tesla Model 3 electric
  { ref: "S7", dealer: "D003", versionId: 15, year: 2021, km: 52000, price: 8900, status: "sold" }, // Dacia Sandero petrol (SOLD)
  { ref: "S8", dealer: "D003", versionId: 10, year: 2022, km: 45000, price: 14500, status: "active" }, // Renault Clio diesel
] as const;

export const ACTIVE_COUNT = FIXTURE.filter((c) => c.status === "active").length; // 7

export function loadSearchFixture(db: DB) {
  const insert = db.prepare(`
    INSERT INTO listings (dealer_id, external_ref, version_id, year, mileage_km, price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const c of FIXTURE) insert.run(c.dealer, c.ref, c.versionId, c.year, c.km, c.price, c.status);
}
