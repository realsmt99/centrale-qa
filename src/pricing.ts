/**
 * Price estimate: exact version + year + mileage -> suggested asking price.
 *
 *   estimate = new price x share kept for the car's age x mileage factor
 *
 * - Share kept by age: a hand-tuned depreciation curve (about -15% a year).
 * - Mileage factor: 1 - km / 500,000, with km capped at 300,000.
 * - Rounded to 100 EUR, never below 1,500 EUR.
 * - Range: estimate -8% / +8%.
 * The response also shows the market: how many active listings exist for the
 * same version and year, and their average price.
 */
import type { DB } from "./db";
import { REFERENCE_YEAR } from "./market";

/** Share of the new price a car keeps, by age in years (index = age; older cars use the last value). */
export const DEPRECIATION_BY_AGE = [1.0, 0.85, 0.72, 0.61, 0.52, 0.44, 0.32, 0.38, 0.27, 0.23, 0.2, 0.17, 0.15];
export const MILEAGE_CAP_KM = 300_000;
export const RANGE_SHARE = 0.08;
export const PRICE_FLOOR = 1500;

const roundTo100 = (x: number) => Math.round(x / 100) * 100;

export interface PriceEstimate {
  versionId: number;
  year: number;
  mileageKm: number;
  estimatedPrice: number;
  range: { low: number; high: number };
  basis: {
    newPrice: number;
    ageYears: number;
    shareKept: number;
    mileageFactor: number;
    comparableListings: number;
    marketAverage: number | null;
  };
}

export type PricingResult =
  | { status: "ok"; estimate: PriceEstimate }
  | { status: "unknown_version" }
  | { status: "year_out_of_range"; soldFrom: number; soldTo: number };

export function estimatePrice(db: DB, q: { versionId: number; year: number; mileageKm: number }): PricingResult {
  const v = db
    .prepare("SELECT id, new_price, year_start, year_end FROM versions WHERE id = ?")
    .get(q.versionId) as { id: number; new_price: number; year_start: number; year_end: number | null } | undefined;
  if (!v) return { status: "unknown_version" };

  // A version can only be priced for the years it was actually sold.
  const soldTo = Math.min(v.year_end ?? REFERENCE_YEAR, REFERENCE_YEAR);
  if (q.year < v.year_start || q.year > soldTo) {
    return { status: "year_out_of_range", soldFrom: v.year_start, soldTo };
  }

  const ageYears = REFERENCE_YEAR - q.year;
  const shareKept = DEPRECIATION_BY_AGE[Math.min(ageYears, DEPRECIATION_BY_AGE.length - 1)];
  const mileageFactor = 1 - Math.min(q.mileageKm, MILEAGE_CAP_KM) / 500_000;
  const estimatedPrice = Math.max(PRICE_FLOOR, roundTo100(v.new_price * shareKept * mileageFactor));

  const market = db
    .prepare("SELECT COUNT(*) AS n, AVG(price) AS avg FROM listings WHERE version_id = ? AND year = ? AND status = 'active'")
    .get(q.versionId, q.year) as { n: number; avg: number | null };

  return {
    status: "ok",
    estimate: {
      versionId: v.id,
      year: q.year,
      mileageKm: q.mileageKm,
      estimatedPrice,
      range: {
        low: Math.max(PRICE_FLOOR, roundTo100(estimatedPrice * (1 - RANGE_SHARE))),
        high: roundTo100(estimatedPrice * (1 + RANGE_SHARE)),
      },
      basis: {
        newPrice: v.new_price,
        ageYears,
        shareKept,
        mileageFactor: Math.round(mileageFactor * 1000) / 1000,
        comparableListings: market.n,
        marketAverage: market.avg === null ? null : roundTo100(market.avg),
      },
    },
  };
}
