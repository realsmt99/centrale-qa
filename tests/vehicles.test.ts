/** Module 2: plate lookup, regression tests (must pass). */
import request from "supertest";
import type { DB } from "../src/db";
import { normalizePlate } from "../src/vehicles";
import { makeTestApp } from "./helpers";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

/** Put a plate in the simulated registry, using a catalogue version's data. */
function register(db: DB, plate: string, versionId: number, firstRegistration: string) {
  db.prepare(`
    INSERT INTO plates (plate, brand, model, fuel, power_hp, first_registration)
    SELECT ?, brand, model, fuel, power_hp, ? FROM versions WHERE id = ?`).run(plate, firstRegistration, versionId);
}

describe("normalizePlate", () => {
  it.each([
    ["AB-123-CD", "AB-123-CD"],
    ["ab123cd", "AB-123-CD"],
    ["ab 123 cd", "AB-123-CD"],
    [" Ab-123 cD ", "AB-123-CD"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizePlate(input)).toBe(expected);
  });

  it.each(["HELLO", "AB-12-CD", "AB-1234-CD", "AO-123-CD", "123-AB-45"])("%j is not a valid plate", (input) => {
    expect(normalizePlate(input)).toBeNull();
  });
});

describe("GET /vehicles/:plate", () => {
  let app: App;
  let db: DB;

  beforeEach(async () => {
    ({ app, db } = await makeTestApp());
    register(db, "BC-234-DE", 9, "2023-03-01"); // Renault Clio E-Tech full hybrid 145
    register(db, "DE-456-FG", 21, "2020-06-01"); // Volkswagen Golf 2.0 TDI 115
  });
  afterEach(async () => {
    await app.close();
  });

  it("returns the exact version, with equipment and new price", async () => {
    const res = await request(app.server).get("/vehicles/BC-234-DE");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plate: "BC-234-DE",
      firstRegistration: "2023-03-01",
      versionId: 9,
      brand: "Renault",
      model: "Clio",
      version: "E-Tech full hybrid 145 Esprit Alpine",
      fuel: "hybrid",
      gearbox: "automatic",
      powerHp: 145,
      newPrice: 27500,
      standardEquipment: expect.arrayContaining(["air_conditioning", "apple_carplay"]),
      optionalEquipment: expect.any(Array),
    });
  });

  it("is public: no token needed", async () => {
    const res = await request(app.server).get("/vehicles/DE-456-FG");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ brand: "Volkswagen", model: "Golf", fuel: "diesel", powerHp: 115 });
  });

  it.each(["de456fg", "de 456 fg", "De-456-Fg"])("accepts the plate typed as %j", async (typed) => {
    const res = await request(app.server).get(`/vehicles/${encodeURIComponent(typed)}`);

    expect(res.status).toBe(200);
    expect(res.body.plate).toBe("DE-456-FG");
  });

  it("400 for something that is not a plate", async () => {
    const res = await request(app.server).get("/vehicles/HELLO");

    expect(res.status).toBe(400);
  });

  it("404 for a valid plate that is not registered", async () => {
    const res = await request(app.server).get("/vehicles/ZZ-999-ZZ");

    expect(res.status).toBe(404);
    expect(res.body.message).toContain("ZZ-999-ZZ");
  });

  it("422 when the registration matches no catalogue version", async () => {
    db.prepare(`
      INSERT INTO plates (plate, brand, model, fuel, power_hp, first_registration)
      VALUES ('LA-123-DA', 'Lada', 'Niva', 'petrol', 83, '2021-01-01')`).run();

    const res = await request(app.server).get("/vehicles/LA-123-DA");

    expect(res.status).toBe(422);
  });

  it("the answer agrees with the registry (SQL check)", async () => {
    const res = await request(app.server).get("/vehicles/BC-234-DE");
    const reg = db.prepare("SELECT brand, model, fuel, power_hp FROM plates WHERE plate = 'BC-234-DE'").get();

    expect(reg).toEqual({
      brand: res.body.brand,
      model: res.body.model,
      fuel: res.body.fuel,
      power_hp: res.body.powerHp,
    });
  });
});
