/**
 * AI ad writer (POST /listings/generate): regression tests (must pass).
 *
 * Example car: versionId 9 = Renault Clio E-Tech full hybrid 145 (automatic),
 * options available: heated_seats, adaptive_cruise_control, towbar.
 * Tests use the free template writer, never a paid API.
 */
import request from "supertest";
import { buildApp } from "../src/app";
import { loadReferenceVersions, openDb } from "../src/db";
import { mentionedEquipment, mentionedGearbox } from "../src/listing-writer";
import { TEST_TOKEN, authHeader, makeTestApp } from "./helpers";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

const clio = { versionId: 9, year: 2024, mileageKm: 30000, price: 18600, color: "blanc", options: ["heated_seats"] };

describe("reading an ad text", () => {
  it("finds the equipment it talks about", () => {
    expect(mentionedEquipment("Clim, GPS intégré et sièges chauffants.")).toEqual(["air_conditioning", "navigation", "heated_seats"]);
  });

  it.each([
    ["essence, boîte manuelle", "manual"],
    ["Boîte automatique à 8 rapports", "automatic"],
    ["manuelle ou automatique ?", "both"],
    ["Très bon état", null],
  ])("finds the gearbox in %j", (text, expected) => {
    expect(mentionedGearbox(text)).toBe(expected);
  });
});

describe("POST /listings/generate", () => {
  let app: App;
  const generate = (body: object, auth = true) => {
    const req = request(app.server).post("/listings/generate");
    return (auth ? req.set(authHeader) : req).send(body);
  };

  beforeEach(async () => {
    ({ app } = await makeTestApp());
  });
  afterEach(async () => {
    await app.close();
  });

  it("401 without a token (writing an ad can cost money)", async () => {
    expect((await generate(clio, false)).status).toBe(401);
  });

  it("writes a French ad and returns the facts it was written from", async () => {
    const res = await generate(clio);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renault Clio E-Tech full hybrid 145 Esprit Alpine - 2024 - 30 000 km");
    expect(res.body.writer).toEqual({ type: "template", model: "template-v1" });
    expect(res.body.facts).toMatchObject({ brand: "Renault", fuel: "hybrid", gearbox: "automatic", powerHp: 145, color: "blanc" });
    for (const text of ["2024", "30 000 km", "18 600 €", "hybride", "145 ch", "sièges chauffants", "blanc"]) {
      expect(res.body.description).toContain(text);
    }
  });

  it("the ad states the right gearbox and only equipment the car has", async () => {
    const res = await generate(clio);

    expect(mentionedGearbox(res.body.description)).toBe(res.body.facts.gearbox);
    for (const code of mentionedEquipment(res.body.description)) {
      expect(res.body.facts.equipment).toContain(code);
    }
  });

  it("400 for an option this version doesn't offer, and says which ones it does", async () => {
    const res = await generate({ ...clio, options: ["panoramic_roof"] });

    expect(res.status).toBe(400);
    expect(res.body.details.available).toEqual(["heated_seats", "adaptive_cruise_control", "towbar"]);
  });

  it("404 for a version that doesn't exist", async () => {
    expect((await generate({ ...clio, versionId: 999 })).status).toBe(404);
  });

  it("422 for a year when this version wasn't sold", async () => {
    const res = await generate({ ...clio, year: 2019 });

    expect(res.status).toBe(422);
    expect(res.body.message).toContain("sold from 2020");
  });

  it.each([
    ["no price", { ...clio, price: undefined }],
    ["a price of 0", { ...clio, price: 0 }],
    ["negative mileage", { ...clio, mileageKm: -1 }],
  ])("400 for %s", async (_label, body) => {
    expect((await generate(body)).status).toBe(400);
  });
});

it("502 when the AI writer is down, without leaking the error", async () => {
  const db = openDb();
  loadReferenceVersions(db);
  const app = await buildApp({
    db,
    apiToken: TEST_TOKEN,
    listingWriter: {
      type: "claude",
      model: "test",
      write: async () => {
        throw new Error("secret upstream detail");
      },
    },
  });

  const res = await request(app.server).post("/listings/generate").set(authHeader).send(clio);

  expect(res.status).toBe(502);
  expect(JSON.stringify(res.body)).not.toContain("secret upstream detail");
  await app.close();
});
