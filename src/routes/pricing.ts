/**
 * GET /pricing?versionId=9&year=2024&mileageKm=30000
 *
 * Public: a seller gets a suggested price before writing the ad.
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { estimatePrice } from "../pricing";

const estimateSchema = {
  type: "object",
  properties: {
    versionId: { type: "integer" },
    year: { type: "integer" },
    mileageKm: { type: "integer" },
    estimatedPrice: { type: "integer", description: "Suggested asking price in euros" },
    range: {
      type: "object",
      properties: { low: { type: "integer" }, high: { type: "integer" } },
    },
    basis: {
      type: "object",
      description: "How the estimate was built",
      properties: {
        newPrice: { type: "integer" },
        ageYears: { type: "integer" },
        shareKept: { type: "number", description: "Share of the new price kept at this age" },
        mileageFactor: { type: "number" },
        comparableListings: { type: "integer", description: "Active listings with the same version and year" },
        marketAverage: { type: ["integer", "null"], description: "Their average price" },
      },
    },
  },
} as const;

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" }, message: { type: "string" } },
} as const;

export async function pricingRoutes(app: FastifyInstance, opts: { db: DB }) {
  app.get<{ Querystring: { versionId: number; year: number; mileageKm: number } }>(
    "/pricing",
    {
      schema: {
        tags: ["pricing"],
        summary: "Suggest a price from the exact version, year and mileage",
        querystring: {
          type: "object",
          required: ["versionId", "year", "mileageKm"],
          properties: {
            versionId: { type: "integer", minimum: 1, description: "Catalogue version (from GET /vehicles/:plate)" },
            year: { type: "integer", minimum: 1990, maximum: 2100, description: "Year of first registration" },
            mileageKm: { type: "integer", minimum: 0, maximum: 2_000_000 },
          },
        },
        response: { 200: estimateSchema, 400: errorSchema, 404: errorSchema, 422: errorSchema },
      },
    },
    async (request, reply) => {
      const result = estimatePrice(opts.db, request.query);
      switch (result.status) {
        case "unknown_version":
          return reply.code(404).send({ error: "Not Found", message: `Unknown versionId: ${request.query.versionId}` });
        case "year_out_of_range":
          return reply.code(422).send({
            error: "Unprocessable Entity",
            message: `This version was sold from ${result.soldFrom} to ${result.soldTo}, not in ${request.query.year}`,
          });
        case "ok":
          return result.estimate;
      }
    },
  );
}
