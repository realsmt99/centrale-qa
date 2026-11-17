/**
 * Plate lookup at scale: an ORACLE check.
 *
 * For every plate on the site we already know the truth twice: what the
 * registry says (brand, model, fuel, power) and which version the listed car
 * really is. The lookup must agree with both.
 * Quick mode: 1,000 plates spread over the 5,000. Nightly: all 5,000.
 */
import type { FastifyInstance } from "fastify";
import { appFor, get, seededDb, spread } from "./scale-helpers";

const db = seededDb();
type Row = { plate: string; brand: string; model: string; fuel: string; power_hp: number; version_id: number };
const rows = db
  .prepare(`
    SELECT p.plate, p.brand, p.model, p.fuel, p.power_hp, l.version_id
    FROM plates p JOIN listings l ON l.plate = p.plate
    ORDER BY l.id`)
  .all() as Row[];
const cases = spread(rows, 1000);

let app: FastifyInstance;
beforeAll(async () => {
  app = await appFor(db);
});
afterAll(async () => {
  await app.close();
});

describe("[vehicles] Rule: the plate lookup agrees with the registry and the listed car", () => {
  it.each(cases)("$plate: $brand $model, $power_hp hp", async (c) => {
    const res = await get(app, `/vehicles/${c.plate}`);

    expect(res.status).toBe(200);
    const b = res.body;
    expect({ brand: b.brand, model: b.model, fuel: b.fuel, powerHp: b.powerHp, versionId: b.versionId }).toEqual({
      brand: c.brand,
      model: c.model,
      fuel: c.fuel,
      powerHp: c.power_hp,
      versionId: c.version_id,
    });
  });
});
