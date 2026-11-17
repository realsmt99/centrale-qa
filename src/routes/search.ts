/**
 * GET /search: buyers filter active listings. Public (no token).
 *
 * Example: /search?brand=Peugeot&fuel=diesel&priceMax=15000&sort=price_asc&page=1
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { FUELS, SORTS, searchListings, type SearchQuery } from "../search";

const resultSchema = {
  type: "object",
  properties: {
    listingId: { type: "integer" },
    brand: { type: "string" },
    model: { type: "string" },
    version: { type: "string" },
    fuel: { type: "string", enum: [...FUELS] },
    gearbox: { type: "string", enum: ["manual", "automatic"] },
    year: { type: "integer" },
    mileageKm: { type: "integer" },
    price: { type: "integer" },
    priceRating: {
      type: "string",
      enum: ["good_deal", "fair", "high"],
      description: "Price vs the average active price of the same version and year",
    },
    dealerId: { type: "string" },
  },
} as const;

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" }, message: { type: "string" } },
} as const;

export async function searchRoutes(app: FastifyInstance, opts: { db: DB }) {
  app.get<{ Querystring: SearchQuery }>(
    "/search",
    {
      schema: {
        tags: ["search"],
        summary: "Search active listings",
        description: "All filters are optional and combined with AND. Sold cars are never returned.",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            brand: { type: "string", maxLength: 50 },
            model: { type: "string", maxLength: 50 },
            fuel: { type: "string", enum: [...FUELS] },
            priceMin: { type: "integer", minimum: 0 },
            priceMax: { type: "integer", minimum: 0 },
            yearMin: { type: "integer", minimum: 1990 },
            yearMax: { type: "integer", minimum: 1990 },
            sort: { type: "string", enum: [...SORTS], default: "price_asc" },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              total: { type: "integer", description: "Number of matching listings (all pages)" },
              page: { type: "integer" },
              pageSize: { type: "integer" },
              results: { type: "array", items: resultSchema },
            },
          },
          400: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const q = request.query;
      if (q.priceMin !== undefined && q.priceMax !== undefined && q.priceMin > q.priceMax) {
        return reply.code(400).send({ error: "Bad Request", message: "priceMin must be <= priceMax" });
      }
      if (q.yearMin !== undefined && q.yearMax !== undefined && q.yearMin > q.yearMax) {
        return reply.code(400).send({ error: "Bad Request", message: "yearMin must be <= yearMax" });
      }
      return searchListings(opts.db, q);
    },
  );
}
