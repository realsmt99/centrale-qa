/**
 * POST /listings/generate: write a French ad for a car.
 *
 * Needs a token: writing with Claude costs money, so strangers can't use it.
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { loadFacts, type ListingRequest, type ListingWriter } from "../listing-writer";

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" }, message: { type: "string" }, details: {} },
} as const;

export async function listingsRoutes(app: FastifyInstance, opts: { db: DB; writer: ListingWriter }) {
  app.post<{ Body: ListingRequest }>(
    "/listings/generate",
    {
      onRequest: app.requireToken,
      schema: {
        tags: ["listings"],
        summary: "Write a French ad (title + description) for a car",
        description:
          "The ad is written from the car's facts: its catalogue version, the options selected by the seller, " +
          "and the year, mileage, price and colour. The facts are returned with the text.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["versionId", "year", "mileageKm", "price"],
          additionalProperties: false,
          properties: {
            versionId: { type: "integer", minimum: 1 },
            year: { type: "integer", minimum: 1990, maximum: 2100 },
            mileageKm: { type: "integer", minimum: 0, maximum: 2_000_000 },
            price: { type: "integer", minimum: 1 },
            color: { type: "string", maxLength: 30 },
            options: {
              type: "array",
              maxItems: 20,
              items: { type: "string", maxLength: 40 },
              description: "Optional equipment the car has (codes from the version's optional equipment)",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              facts: {
                type: "object",
                properties: {
                  versionId: { type: "integer" },
                  brand: { type: "string" },
                  model: { type: "string" },
                  version: { type: "string" },
                  fuel: { type: "string" },
                  gearbox: { type: "string" },
                  powerHp: { type: "integer" },
                  year: { type: "integer" },
                  mileageKm: { type: "integer" },
                  price: { type: "integer" },
                  color: { type: ["string", "null"] },
                  equipment: { type: "array", items: { type: "string" } },
                },
              },
              writer: {
                type: "object",
                properties: { type: { type: "string", enum: ["template", "claude"] }, model: { type: "string" } },
              },
            },
          },
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          422: errorSchema,
          502: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = loadFacts(opts.db, request.body);
      switch (result.status) {
        case "unknown_version":
          return reply.code(404).send({ error: "Not Found", message: `Unknown versionId: ${request.body.versionId}` });
        case "year_out_of_range":
          return reply.code(422).send({
            error: "Unprocessable Entity",
            message: `This version was sold from ${result.soldFrom} to ${result.soldTo}, not in ${request.body.year}`,
          });
        case "unknown_options":
          return reply.code(400).send({
            error: "Bad Request",
            message: `Option(s) not available for this version: ${result.options.join(", ")}`,
            details: { available: result.available },
          });
      }

      try {
        const ad = await opts.writer.write(result.facts);
        return { ...ad, facts: result.facts, writer: { type: opts.writer.type, model: opts.writer.model } };
      } catch (err) {
        request.log.error(err);
        return reply.code(502).send({ error: "Bad Gateway", message: "The ad writer is unavailable, try again later" });
      }
    },
  );
}
