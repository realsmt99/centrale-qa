/**
 * Price estimate at scale: METAMORPHIC rules.
 *
 * We don't know the "right" price of a car. But we know how the prices of two
 * RELATED cars must compare (US-002): one year older -> never more expensive,
 * more km -> never more expensive, never above the new price.
 * Each rule is checked on every version, every year it was sold, and 6 mileages.
 */
import type { FastifyInstance } from "fastify";
import { soldYears } from "../../src/market";
import { appFor, get, seededDb, versionName } from "./scale-helpers";

const db = seededDb(0); // catalogue and dealers only: pricing doesn't need listings
type Version = { id: number; brand: string; model: string; version: string; year_start: number; year_end: number | null; new_price: number };
const versions = db.prepare("SELECT * FROM versions ORDER BY id").all() as Version[];
const KMS = [0, 30_000, 60_000, 100_000, 150_000, 250_000];

const versionYears = versions.flatMap((v) => {
  const sold = soldYears(v);
  return Array.from({ length: sold.to - sold.from + 1 }, (_, i) => ({ v, year: sold.from + i, label: `${versionName(v)}, ${sold.from + i}` }));
});
const olderPairs = versionYears
  .filter(({ v, year }) => year < soldYears(v).to)
  .flatMap(({ v, year }) => KMS.map((km) => ({ versionId: v.id, year, km, label: `${versionName(v)}, ${km} km: ${year} vs ${year + 1}` })));

let app: FastifyInstance;
beforeAll(async () => {
  app = await appFor(db);
});
afterAll(async () => {
  await app.close();
});

const estimate = async (versionId: number, year: number, km: number) =>
  (await get(app, `/pricing?versionId=${versionId}&year=${year}&mileageKm=${km}`)).body as {
    estimatedPrice: number;
    range: { low: number; high: number };
  };

describe("[pricing] Rule: one year older is never estimated higher", () => {
  it.each(olderPairs)("$label", async ({ versionId, year, km }) => {
    const older = await estimate(versionId, year, km);
    const newer = await estimate(versionId, year + 1, km);

    expect(older.estimatedPrice).toBeLessThanOrEqual(newer.estimatedPrice);
  });
});

describe("[pricing] Rule: more kilometres is never estimated higher", () => {
  it.each(versionYears)("$label", async ({ v, year }) => {
    const prices: number[] = [];
    for (const km of [...KMS, 400_000]) prices.push((await estimate(v.id, year, km)).estimatedPrice);

    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
  });
});

describe("[pricing] Rule: never above the new price, always inside its own range", () => {
  it.each(versionYears)("$label", async ({ v, year }) => {
    for (const km of KMS) {
      const e = await estimate(v.id, year, km);
      expect(e.estimatedPrice).toBeLessThanOrEqual(v.new_price);
      expect(e.range.low).toBeLessThanOrEqual(e.estimatedPrice);
      expect(e.estimatedPrice).toBeLessThanOrEqual(e.range.high);
    }
  });
});
