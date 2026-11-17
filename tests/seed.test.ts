/** Checks on the synthetic data itself, so we can trust it in later tests. */
import { openDb } from "../src/db";
import { seed } from "../data/generate";

describe("synthetic data", () => {
  const db = openDb(":memory:");
  seed(db, { listings: 500 });
  const one = <T>(sql: string) => db.prepare(sql).get() as T;

  it("creates the requested number of listings, all active", () => {
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM listings WHERE status = 'active'").n).toBe(500);
  });

  it("gives every listing a plate that exists in the plates table (SQL check)", () => {
    const orphans = one<{ n: number }>(`
      SELECT COUNT(*) AS n FROM listings l
      LEFT JOIN plates p ON p.plate = l.plate
      WHERE p.plate IS NULL`);
    expect(orphans.n).toBe(0);
  });

  it("registry data matches each listing's real version (the truth for plate lookup)", () => {
    const mismatches = one<{ n: number }>(`
      SELECT COUNT(*) AS n FROM listings l
      JOIN versions v ON v.id = l.version_id
      JOIN plates p ON p.plate = l.plate
      WHERE p.brand <> v.brand OR p.model <> v.model OR p.fuel <> v.fuel OR p.power_hp <> v.power_hp
         OR CAST(substr(p.first_registration, 1, 4) AS INTEGER) <> l.year`);
    expect(mismatches.n).toBe(0);
  });

  it("only uses years when the version was actually sold", () => {
    const bad = one<{ n: number }>(`
      SELECT COUNT(*) AS n FROM listings l JOIN versions v ON v.id = l.version_id
      WHERE l.year < v.year_start OR (v.year_end IS NOT NULL AND l.year > v.year_end)`);
    expect(bad.n).toBe(0);
  });

  it("is deterministic: same seed, same data", () => {
    const other = openDb(":memory:");
    seed(other, { listings: 500 });
    const fingerprint = (d: typeof db) =>
      d.prepare("SELECT group_concat(plate || price, ',') AS f FROM listings ORDER BY id").get();
    expect(fingerprint(other)).toEqual(fingerprint(db));
  });
});
