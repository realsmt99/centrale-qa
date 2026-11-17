/**
 * Search logic: buyers filter active listings.
 *
 * Every result also gets a price rating, like the badges on a marketplace:
 * the car's price is compared with the average price of the same version
 * and year among active listings.
 *   price < 90% of average  -> good_deal
 *   price > 110% of average -> high
 *   otherwise               -> fair
 */
import type { DB } from "./db";

export const FUELS = ["petrol", "diesel", "hybrid", "plug_in_hybrid", "diesel_hybrid", "electric", "lpg"] as const;
export const SORTS = ["price_asc", "price_desc", "year_desc", "mileage_asc"] as const;

export interface SearchQuery {
  brand?: string;
  model?: string;
  fuel?: (typeof FUELS)[number];
  priceMin?: number;
  priceMax?: number;
  yearMin?: number;
  yearMax?: number;
  sort?: (typeof SORTS)[number];
  page?: number;
  pageSize?: number;
}

export type PriceRating = "good_deal" | "fair" | "high";

export interface SearchResult {
  listingId: number;
  brand: string;
  model: string;
  version: string;
  fuel: string;
  gearbox: string;
  year: number;
  mileageKm: number;
  price: number;
  priceRating: PriceRating;
  dealerId: string;
}

export interface SearchPage {
  total: number;
  page: number;
  pageSize: number;
  results: SearchResult[];
}

const ORDER_BY: Record<(typeof SORTS)[number], string> = {
  price_asc: "l.price ASC, l.id ASC",
  price_desc: "l.price DESC, l.id ASC",
  year_desc: "l.year DESC, l.id ASC",
  mileage_asc: "l.mileage_km ASC, l.id ASC",
};

export function priceRating(price: number, averagePrice: number): PriceRating {
  if (price < averagePrice * 0.9) return "good_deal";
  if (price > averagePrice * 1.1) return "high";
  return "fair";
}

export function searchListings(db: DB, q: SearchQuery): SearchPage {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;

  // Build the WHERE clause from the filters that were given.
  const where: string[] = ["l.status = 'active'"];
  const params: (string | number)[] = [];
  if (q.brand) {
    where.push("v.brand = ? COLLATE NOCASE");
    params.push(q.brand);
  }
  if (q.model) {
    where.push("v.model = ? COLLATE NOCASE");
    params.push(q.model);
  }
  if (q.fuel) {
    where.push("v.fuel LIKE ?");
    params.push(`%${q.fuel}%`);
  }
  if (q.priceMin !== undefined) {
    where.push("l.price >= ?");
    params.push(q.priceMin);
  }
  if (q.priceMax !== undefined) {
    where.push("l.price <= ?");
    params.push(q.priceMax);
  }
  if (q.yearMin !== undefined) {
    where.push("l.year >= ?");
    params.push(q.yearMin);
  }
  if (q.yearMax !== undefined) {
    where.push("l.year <= ?");
    params.push(q.yearMax);
  }

  const matches = db
    .prepare(`
      SELECT l.id, l.version_id, l.year, l.mileage_km, l.price, l.dealer_id
      FROM listings l JOIN versions v ON v.id = l.version_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${ORDER_BY[q.sort ?? "price_asc"]}`)
    .all(...params) as {
    id: number;
    version_id: number;
    year: number;
    mileage_km: number;
    price: number;
    dealer_id: string;
  }[];

  const getVersion = db.prepare("SELECT brand, model, version, fuel, gearbox FROM versions WHERE id = ?");
  const getAveragePrice = db.prepare(`
    SELECT AVG(price) AS avg FROM listings
    WHERE version_id = ? AND year = ? AND status = 'active'`);

  const enriched: SearchResult[] = matches.map((row) => {
    const v = getVersion.get(row.version_id) as {
      brand: string;
      model: string;
      version: string;
      fuel: string;
      gearbox: string;
    };
    const { avg } = getAveragePrice.get(row.version_id, row.year) as { avg: number };
    return {
      listingId: row.id,
      brand: v.brand,
      model: v.model,
      version: v.version,
      fuel: v.fuel,
      gearbox: v.gearbox,
      year: row.year,
      mileageKm: row.mileage_km,
      price: row.price,
      priceRating: priceRating(row.price, avg),
      dealerId: row.dealer_id,
    };
  });

  const start = (page - 1) * pageSize;
  return { total: enriched.length, page, pageSize, results: enriched.slice(start, start + pageSize) };
}
