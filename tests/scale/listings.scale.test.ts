/**
 * AI ad writer at scale: the ad must say only true things (US-003).
 *
 * For every one of the 41 versions, an ad is generated and READ back by code:
 * which equipment does it claim, which gearbox, which numbers? Each claim is
 * compared with the facts returned next to the ad. Plain code decides.
 */
import type { FastifyInstance } from "fastify";
import { formatFr, mentionedEquipment, mentionedGearbox } from "../../src/listing-writer";
import { soldYears } from "../../src/market";
import { appFor, post, seededDb, versionName } from "./scale-helpers";

const db = seededDb(0);
type Version = { id: number; brand: string; model: string; version: string; year_start: number; year_end: number | null };
const cases = (db.prepare("SELECT * FROM versions ORDER BY id").all() as Version[]).map((v) => ({
  versionId: v.id,
  year: soldYears(v).to,
  label: versionName(v),
}));

let app: FastifyInstance;
beforeAll(async () => {
  app = await appFor(db);
});
afterAll(async () => {
  await app.close();
});

const ad = async (versionId: number, year: number) =>
  (await post(app, "/listings/generate", { versionId, year, mileageKm: 42_000, price: 12_300 })).body as {
    description: string;
    facts: { equipment: string[]; gearbox: string; powerHp: number };
  };

describe("[listings] Rule: an ad only mentions equipment the car has", () => {
  it.each(cases)("$label", async ({ versionId, year }) => {
    const a = await ad(versionId, year);

    const invented = mentionedEquipment(a.description).filter((code) => !a.facts.equipment.includes(code));
    expect(invented).toEqual([]);
  });
});

describe("[listings] Rule: an ad states the car's real gearbox", () => {
  it.each(cases)("$label", async ({ versionId, year }) => {
    const a = await ad(versionId, year);

    expect(mentionedGearbox(a.description)).toBe(a.facts.gearbox);
  });
});

describe("[listings] Rule: an ad states the right year, mileage, price and power", () => {
  it.each(cases)("$label", async ({ versionId, year }) => {
    const a = await ad(versionId, year);

    for (const text of [String(year), `${formatFr(42_000)} km`, `${formatFr(12_300)} €`, `${a.facts.powerHp} ch`]) {
      expect(a.description).toContain(text);
    }
  });
});
