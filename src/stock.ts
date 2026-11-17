/**
 * Stock import logic (no HTTP here, so it can be tested directly).
 *
 * A dealer feed is a FULL snapshot of the dealer's current stock:
 *   - car in the feed, not in our DB     -> new listing        (created)
 *   - car in both, price or km changed   -> update the listing (updated)
 *   - car in both, nothing changed       -> leave it           (unchanged)
 *   - active car in our DB, not in feed  -> the car was sold   (markedSold)
 *
 * A car is identified by (dealer_id, external_ref): the ID the dealer's own
 * software gives it.
 */
import type { DB } from "./db";

export interface FeedCar {
  externalRef: string;
  versionId: number;
  plate?: string;
  year: number;
  mileageKm: number;
  price: number;
  color?: string;
}

export interface ImportResult {
  dealerId: string;
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  markedSold: number;
}

/** Dealer refs are stored trimmed and upper-case, so "vo-12" and "VO-12" are the same car. */
export function normalizeRef(ref: string): string {
  return ref.trim().toUpperCase();
}

/** Refs that appear more than once in the same feed (after normalizing). */
export function duplicateRefs(cars: FeedCar[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const car of cars) {
    const ref = normalizeRef(car.externalRef);
    if (seen.has(ref)) dupes.add(ref);
    seen.add(ref);
  }
  return [...dupes];
}

/** Version IDs used in the feed that don't exist in the reference catalogue. */
export function unknownVersionIds(db: DB, cars: FeedCar[]): number[] {
  const known = new Set(
    (db.prepare("SELECT id FROM versions").all() as { id: number }[]).map((r) => r.id),
  );
  return [...new Set(cars.map((c) => c.versionId))].filter((id) => !known.has(id));
}

export function importStock(db: DB, dealerId: string, cars: FeedCar[]): ImportResult {
  const result: ImportResult = { dealerId, received: cars.length, created: 0, updated: 0, unchanged: 0, markedSold: 0 };

  const findActive = db.prepare(`
    SELECT id, price, mileage_km FROM listings
    WHERE dealer_id = ? AND external_ref = ? AND status = 'active'`);
  const insert = db.prepare(`
    INSERT INTO listings (dealer_id, external_ref, version_id, plate, year, mileage_km, price, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`
    UPDATE listings SET price = ?, mileage_km = ?, updated_at = datetime('now') WHERE id = ?`);
  const markMissingAsSold = db.prepare(`
    UPDATE listings SET status = 'sold', updated_at = datetime('now')
    WHERE dealer_id = ? AND status = 'active'
      AND external_ref NOT IN (SELECT value FROM json_each(?))`);

  // All or nothing: if anything fails, the whole import is rolled back.
  db.transaction(() => {
    for (const car of cars) {
      const existing = findActive.get(dealerId, car.externalRef) as
        | { id: number; price: number; mileage_km: number }
        | undefined;

      if (!existing) {
        insert.run(
          dealerId,
          normalizeRef(car.externalRef),
          car.versionId,
          car.plate ?? null,
          car.year,
          car.mileageKm,
          car.price,
          car.color ?? null,
        );
        result.created++;
      } else if (existing.price !== car.price || existing.mileage_km !== car.mileageKm) {
        update.run(car.price, car.mileageKm, existing.id);
        result.updated++;
      } else {
        result.unchanged++;
      }
    }

    if (cars.length > 0) {
      const refsInFeed = JSON.stringify(cars.map((c) => normalizeRef(c.externalRef)));
      result.markedSold = markMissingAsSold.run(dealerId, refsInFeed).changes;
    }
  })();

  return result;
}
