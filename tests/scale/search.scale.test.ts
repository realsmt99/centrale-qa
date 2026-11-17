/**
 * Search at scale.
 *
 * 1. DATA-DRIVEN: every fuel x every brand (7 x 11 = 77 searches). The
 *    answer is compared with SQL (the database is the truth): same total,
 *    and no car with another fuel on the page.
 * 2. METAMORPHIC performance: with 20 results per page, page 1 should cost
 *    about the same whether 75 or 5,000 cars match. We compare two timings on
 *    the same machine instead of using a fixed budget, so a slow CI runner
 *    doesn't make the test flaky.
 */
import type { FastifyInstance } from "fastify";
import { FUELS } from "../../src/search";
import { appFor, get, seededDb } from "./scale-helpers";

const db = seededDb();
const brands = (db.prepare("SELECT DISTINCT brand FROM versions ORDER BY brand").all() as { brand: string }[]).map((r) => r.brand);
const fuelBrand = FUELS.flatMap((fuel) => brands.map((brand) => ({ fuel, brand, label: `fuel=${fuel}, brand=${brand}` })));

let app: FastifyInstance;
beforeAll(async () => {
  app = await appFor(db);
});
afterAll(async () => {
  await app.close();
});

describe("[search] Rule: the fuel filter returns exactly the cars with that fuel (checked against SQL)", () => {
  it.each(fuelBrand)("$label", async ({ fuel, brand }) => {
    const truth = db
      .prepare(`
        SELECT COUNT(*) AS n FROM listings l JOIN versions v ON v.id = l.version_id
        WHERE l.status = 'active' AND v.fuel = ? AND v.brand = ?`)
      .get(fuel, brand) as { n: number };

    const body = (await get(app, `/search?fuel=${fuel}&brand=${encodeURIComponent(brand)}&pageSize=100`)).body;

    expect(body.results.filter((r: { fuel: string }) => r.fuel !== fuel)).toEqual([]);
    expect(body.total).toBe(truth.n);
  });
});

describe("[search] Rule: page 1 costs about the same, whatever the number of matches", () => {
  const median = async (query: string) => {
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await get(app, `/search?${query}`);
      runs.push(performance.now() - start);
    }
    return runs.sort((a, b) => a - b)[2];
  };

  it("no filter (5,000 matches) vs Tesla Model 3 2025+ (about 75 matches), 20 results per page", async () => {
    await get(app, "/search?brand=Tesla"); // warm-up
    const narrow = await median("brand=Tesla&model=Model%203&yearMin=2025");
    const broad = await median("");

    expect(broad).toBeLessThan(3 * narrow + 20);
  }, 60_000);
});
