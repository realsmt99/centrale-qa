/**
 * Synthetic data generator. Run: npm run seed
 *
 * Builds data/centrale.db from the reference catalogue:
 *   - 20 dealers
 *   - 5,000 used-car listings, each with a unique French plate
 *
 * Everything is generated (no scraping). A fixed seed means the same
 * data every run, so test results can be compared from one run to the next.
 */
import { existsSync, rmSync } from "node:fs";
import { loadReferenceVersions, openDb, type DB, type ReferenceVersion } from "../src/db";
import referenceVersions from "./reference-versions.json";

export const REFERENCE_YEAR = 2026; // "today" for the synthetic market

/** Small seeded random generator (mulberry32): same seed -> same numbers. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}
export type Rng = ReturnType<typeof makeRng>;

// French SIV plates never use I, O or U.
const PLATE_LETTERS = "ABCDEFGHJKLMNPQRSTVWXYZ";

export function makePlate(rng: Rng): string {
  const l = () => PLATE_LETTERS[rng.int(0, PLATE_LETTERS.length - 1)];
  const n = String(rng.int(1, 999)).padStart(3, "0");
  return `${l()}${l()}-${n}-${l()}${l()}`;
}

const CITIES = ["Paris", "Lyon", "Marseille", "Toulouse", "Lille", "Bordeaux", "Nantes", "Strasbourg", "Rennes", "Nice"];
const COLORS = ["blanc", "noir", "gris", "bleu", "rouge", "argent"];

/**
 * Simple, realistic price model: about 15% value lost per year,
 * minus a little per km driven. Rounded to the nearest 100 EUR.
 */
export function marketPrice(v: ReferenceVersion, year: number, mileageKm: number): number {
  const age = REFERENCE_YEAR - year;
  const value = v.newPrice * Math.pow(0.85, age) * (1 - Math.min(mileageKm, 300_000) / 500_000);
  return Math.max(1500, Math.round(value / 100) * 100);
}

export function seed(db: DB, { listings = 5000, dealers = 20, seedValue = 42 } = {}) {
  const rng = makeRng(seedValue);
  const versions = referenceVersions as ReferenceVersion[];
  loadReferenceVersions(db);

  const insertDealer = db.prepare("INSERT INTO dealers (id, name, city) VALUES (?, ?, ?)");
  const insertPlate = db.prepare("INSERT INTO plates (plate, version_id, first_registration) VALUES (?, ?, ?)");
  const insertListing = db.prepare(`
    INSERT INTO listings (dealer_id, external_ref, version_id, plate, year, mileage_km, price, color, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`);

  db.transaction(() => {
    const dealerIds: string[] = [];
    for (let i = 1; i <= dealers; i++) {
      const id = `D${String(i).padStart(3, "0")}`;
      const city = rng.pick(CITIES);
      insertDealer.run(id, `Garage ${city} ${i}`, city);
      dealerIds.push(id);
    }

    const usedPlates = new Set<string>();
    for (let i = 1; i <= listings; i++) {
      const v = rng.pick(versions);
      const lastYear = Math.min(v.yearEnd ?? REFERENCE_YEAR, REFERENCE_YEAR);
      const year = rng.int(v.yearStart, lastYear);
      const age = REFERENCE_YEAR - year;
      const mileage = Math.max(50, age * rng.int(8_000, 18_000) + rng.int(0, 5_000));

      let plate = makePlate(rng);
      while (usedPlates.has(plate)) plate = makePlate(rng);
      usedPlates.add(plate);

      const month = String(rng.int(1, 12)).padStart(2, "0");
      insertPlate.run(plate, v.id, `${year}-${month}-01`);
      insertListing.run(
        rng.pick(dealerIds),
        `REF-${String(i).padStart(6, "0")}`,
        v.id,
        plate,
        year,
        mileage,
        marketPrice(v, year, mileage),
        rng.pick(COLORS),
      );
    }
  })();
}

// Run as a script: rebuild data/centrale.db from scratch.
if (require.main === module) {
  const path = process.env.DB_PATH ?? "data/centrale.db";
  if (existsSync(path)) rmSync(path);
  const db = openDb(path);
  const start = Date.now();
  seed(db);
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  console.log(
    `Seeded ${path} in ${Date.now() - start} ms: ${n("versions")} versions, ${n("dealers")} dealers, ` +
      `${n("plates")} plates, ${n("listings")} listings`,
  );
  db.close();
}
