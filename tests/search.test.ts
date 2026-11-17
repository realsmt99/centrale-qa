/** Module 3: search, regression tests (must pass). */
import request from "supertest";
import type { DB } from "../src/db";
import { priceRating } from "../src/search";
import { makeTestApp } from "./helpers";
import { ACTIVE_COUNT, loadSearchFixture } from "./search-fixture";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

describe("priceRating", () => {
  it.each([
    [8000, 10000, "good_deal"],
    [9000, 10000, "fair"],
    [11000, 10000, "fair"],
    [12000, 10000, "high"],
  ])("price %d vs average %d -> %s", (price, avg, expected) => {
    expect(priceRating(price, avg)).toBe(expected);
  });
});

describe("GET /search", () => {
  let app: App;
  let db: DB;
  const search = (query: string) => request(app.server).get(`/search?${query}`);
  const prices = (res: request.Response) => res.body.results.map((r: { price: number }) => r.price);

  beforeEach(async () => {
    ({ app, db } = await makeTestApp());
    loadSearchFixture(db);
  });
  afterEach(async () => {
    await app.close();
  });

  it("with no filter: every active car, cheapest first, sold cars excluded", async () => {
    const res = await search("");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(ACTIVE_COUNT);
    expect(prices(res)).toEqual([13900, 14500, 16900, 17400, 21500, 29900, 39900]);
    expect(prices(res)).not.toContain(8900); // the sold Sandero
  });

  it("filters by brand, ignoring case", async () => {
    const upper = await search("brand=Peugeot");
    const lower = await search("brand=peugeot");

    expect(prices(upper)).toEqual([13900, 16900]);
    expect(prices(lower)).toEqual(prices(upper));
  });

  it("filters by brand and model", async () => {
    const res = await search("brand=Renault&model=Clio");

    expect(prices(res)).toEqual([14500, 21500]);
  });

  it("filters by fuel", async () => {
    const res = await search("fuel=electric");

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ brand: "Tesla", fuel: "electric" });
  });

  it("filters by price range (bounds included)", async () => {
    const res = await search("priceMin=14500&priceMax=17400");

    expect(prices(res)).toEqual([14500, 16900, 17400]);
  });

  it("filters by year range", async () => {
    const res = await search("yearMin=2023");

    expect(res.body.results.every((r: { year: number }) => r.year >= 2023)).toBe(true);
    expect(res.body.total).toBe(2);
  });

  it.each([
    ["price_desc", [39900, 29900, 21500]],
    ["mileage_asc", [21500, 16900, 39900]],
  ])("sorts with sort=%s", async (sort, firstThree) => {
    const res = await search(`sort=${sort}`);

    expect(prices(res).slice(0, 3)).toEqual(firstThree);
  });

  it("paginates without overlap or gaps", async () => {
    const pages = await Promise.all([1, 2, 3, 4].map((p) => search(`pageSize=2&page=${p}`)));
    const ids = pages.flatMap((p) => p.body.results.map((r: { listingId: number }) => r.listingId));

    expect(pages.map((p) => p.body.results.length)).toEqual([2, 2, 2, 1]);
    expect(new Set(ids).size).toBe(ACTIVE_COUNT);
    expect(pages.every((p) => p.body.total === ACTIVE_COUNT)).toBe(true);
  });

  it("returns an empty page after the last one", async () => {
    const res = await search("pageSize=20&page=99");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: ACTIVE_COUNT, results: [] });
  });

  it("gives every result a price rating", async () => {
    const res = await search("");

    for (const r of res.body.results) expect(["good_deal", "fair", "high"]).toContain(r.priceRating);
  });

  it.each([
    ["priceMin above priceMax", "priceMin=20000&priceMax=10000"],
    ["yearMin above yearMax", "yearMin=2023&yearMax=2020"],
    ["unknown fuel", "fuel=kerosene"],
    ["pageSize over 100", "pageSize=500"],
    ["page 0", "page=0"],
    ["negative price", "priceMin=-1"],
  ])("400 for %s", async (_label, query) => {
    const res = await search(query);

    expect(res.status).toBe(400);
  });

  it("every returned listing is really active in the database (SQL check)", async () => {
    const res = await search("pageSize=100");
    const ids = res.body.results.map((r: { listingId: number }) => r.listingId);

    const notActive = db
      .prepare(`SELECT id FROM listings WHERE status <> 'active' AND id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids));
    expect(notActive).toEqual([]);
  });
});
