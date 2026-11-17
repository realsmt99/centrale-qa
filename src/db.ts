/**
 * Database layer: one SQLite file (or ":memory:" in tests).
 *
 * We write plain SQL on purpose (no ORM) so every query is visible.
 * That makes the SQL consistency checks in the tests easy to read.
 */
import Database from "better-sqlite3";
import referenceVersions from "../data/reference-versions.json";

export type DB = Database.Database;

export interface ReferenceVersion {
  id: number;
  brand: string;
  model: string;
  version: string;
  fuel: string; // petrol | diesel | hybrid | plug_in_hybrid | diesel_hybrid | electric
  gearbox: string; // manual | automatic
  powerHp: number;
  yearStart: number;
  yearEnd: number | null; // null = still sold new
  newPrice: number; // euros
  standardEquipment: string[];
  optionalEquipment: string[];
}

/** The database schema (also given to QA Pilot so it can propose correct SQL checks). */
export const SCHEMA_SQL = `
-- Reference catalogue: one row per exact version (e.g. "Peugeot 208 1.2 PureTech 100 Allure").
CREATE TABLE IF NOT EXISTS versions (
  id                 INTEGER PRIMARY KEY,
  brand              TEXT    NOT NULL,
  model              TEXT    NOT NULL,
  version            TEXT    NOT NULL,
  fuel               TEXT    NOT NULL,
  gearbox            TEXT    NOT NULL,
  power_hp           INTEGER NOT NULL,
  year_start         INTEGER NOT NULL,
  year_end           INTEGER,
  new_price          INTEGER NOT NULL,
  standard_equipment TEXT    NOT NULL, -- JSON array
  optional_equipment TEXT    NOT NULL  -- JSON array
);

-- Simulated national registry (SIV): what the registration card says.
-- It does NOT know the exact catalogue version: the plate lookup must
-- match these fields to one row in "versions".
CREATE TABLE IF NOT EXISTS plates (
  plate              TEXT PRIMARY KEY,           -- French SIV format: AB-123-CD
  brand              TEXT    NOT NULL,
  model              TEXT    NOT NULL,
  fuel               TEXT    NOT NULL,
  power_hp           INTEGER NOT NULL,
  first_registration TEXT    NOT NULL            -- YYYY-MM-DD
);

-- Professional sellers who send stock feeds.
CREATE TABLE IF NOT EXISTS dealers (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL
);

-- Cars for sale. A dealer identifies its own cars with external_ref
-- (the ID used in the dealer's own software).
CREATE TABLE IF NOT EXISTS listings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id    TEXT    NOT NULL REFERENCES dealers(id),
  external_ref TEXT    NOT NULL,
  version_id   INTEGER NOT NULL REFERENCES versions(id),
  plate        TEXT,
  year         INTEGER NOT NULL,
  mileage_km   INTEGER NOT NULL,
  price        INTEGER NOT NULL,
  color        TEXT,
  status       TEXT    NOT NULL DEFAULT 'active', -- active | sold
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;

/** Open (or create) a database and make sure all tables exist. */
export function openDb(path = ":memory:"): DB {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

/** Load the reference catalogue (idempotent: safe to call twice). */
export function loadReferenceVersions(db: DB): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO versions
      (id, brand, model, version, fuel, gearbox, power_hp, year_start, year_end,
       new_price, standard_equipment, optional_equipment)
    VALUES
      (@id, @brand, @model, @version, @fuel, @gearbox, @powerHp, @yearStart, @yearEnd,
       @newPrice, @standardEquipment, @optionalEquipment)
  `);
  const insertAll = db.transaction((rows: ReferenceVersion[]) => {
    for (const v of rows) {
      insert.run({
        ...v,
        standardEquipment: JSON.stringify(v.standardEquipment),
        optionalEquipment: JSON.stringify(v.optionalEquipment),
      });
    }
  });
  const rows = referenceVersions as ReferenceVersion[];
  insertAll(rows);
  return rows.length;
}
