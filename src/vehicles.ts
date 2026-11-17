/**
 * Plate lookup logic: license plate -> exact catalogue version.
 *
 * Two steps, like in real life:
 *   1. Ask the registry (SIV) what the registration card says:
 *      brand, model, fuel, power, first registration date.
 *   2. Match that to ONE version in our reference catalogue, so the ad can
 *      be pre-filled with the right gearbox, equipment and new price.
 */
import type { DB } from "./db";

// French SIV plates: 2 letters, 3 digits, 2 letters. I, O and U are never used.
const PLATE_RE = /^([A-HJ-NP-TV-Z]{2})(\d{3})([A-HJ-NP-TV-Z]{2})$/;

/** "ab 123 cd", "AB123CD", "ab-123-cd" -> "AB-123-CD". Returns null if it isn't a valid plate. */
export function normalizePlate(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  const m = PLATE_RE.exec(compact);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

interface Registration {
  plate: string;
  brand: string;
  model: string;
  fuel: string;
  power_hp: number;
  first_registration: string;
}

interface VersionRow {
  id: number;
  brand: string;
  model: string;
  version: string;
  fuel: string;
  gearbox: string;
  power_hp: number;
  new_price: number;
  standard_equipment: string;
  optional_equipment: string;
}

export interface VehicleInfo {
  plate: string;
  firstRegistration: string;
  versionId: number;
  brand: string;
  model: string;
  version: string;
  fuel: string;
  gearbox: string;
  powerHp: number;
  newPrice: number;
  standardEquipment: string[];
  optionalEquipment: string[];
}

export type LookupResult =
  | { status: "found"; vehicle: VehicleInfo }
  | { status: "unknown_plate" }
  | { status: "no_matching_version"; registration: Registration };

/** Step 2: find the catalogue version that fits the registration card. */
function matchVersion(db: DB, reg: Registration): VersionRow | undefined {
  const year = Number(reg.first_registration.slice(0, 4));
  return db
    .prepare(`
      SELECT * FROM versions
      WHERE brand = ? AND model = ? AND fuel = ?
        AND year_start <= ? AND (year_end IS NULL OR year_end >= ?)
      ORDER BY id`)
    .get(reg.brand, reg.model, reg.fuel, year, year) as VersionRow | undefined;
}

export function lookupVehicle(db: DB, plate: string): LookupResult {
  // Step 1: registry
  const reg = db.prepare("SELECT * FROM plates WHERE plate = ?").get(plate) as Registration | undefined;
  if (!reg) return { status: "unknown_plate" };

  // Step 2: catalogue match
  const v = matchVersion(db, reg);
  if (!v) return { status: "no_matching_version", registration: reg };

  return {
    status: "found",
    vehicle: {
      plate: reg.plate,
      firstRegistration: reg.first_registration,
      versionId: v.id,
      brand: v.brand,
      model: v.model,
      version: v.version,
      fuel: v.fuel,
      gearbox: v.gearbox,
      powerHp: v.power_hp,
      newPrice: v.new_price,
      standardEquipment: JSON.parse(v.standard_equipment),
      optionalEquipment: JSON.parse(v.optional_equipment),
    },
  };
}
