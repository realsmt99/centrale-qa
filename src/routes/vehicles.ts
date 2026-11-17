/**
 * GET /vehicles/:plate
 *
 * Public (no token): a seller types a plate and the ad form is pre-filled.
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { lookupVehicle, normalizePlate } from "../vehicles";

const vehicleSchema = {
  type: "object",
  properties: {
    plate: { type: "string", example: "AB-123-CD" },
    firstRegistration: { type: "string", format: "date" },
    versionId: { type: "integer" },
    brand: { type: "string" },
    model: { type: "string" },
    version: { type: "string" },
    fuel: { type: "string", enum: ["petrol", "diesel", "hybrid", "plug_in_hybrid", "diesel_hybrid", "electric", "lpg"] },
    gearbox: { type: "string", enum: ["manual", "automatic"] },
    powerHp: { type: "integer" },
    newPrice: { type: "integer", description: "List price when new, in euros" },
    standardEquipment: { type: "array", items: { type: "string" } },
    optionalEquipment: { type: "array", items: { type: "string" } },
  },
} as const;

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" }, message: { type: "string" } },
} as const;

export async function vehiclesRoutes(app: FastifyInstance, opts: { db: DB }) {
  app.get<{ Params: { plate: string } }>(
    "/vehicles/:plate",
    {
      schema: {
        tags: ["vehicles"],
        summary: "Identify the exact vehicle version from a French license plate",
        description:
          "Reads the registration data for the plate, then matches it to one version of the " +
          "reference catalogue. Accepts AB-123-CD, AB123CD or ab 123 cd.",
        params: {
          type: "object",
          properties: { plate: { type: "string", minLength: 1, maxLength: 20 } },
        },
        response: { 200: vehicleSchema, 400: errorSchema, 404: errorSchema, 422: errorSchema },
      },
    },
    async (request, reply) => {
      const plate = normalizePlate(request.params.plate);
      if (!plate) {
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "Not a valid French plate (expected AB-123-CD)" });
      }

      const result = lookupVehicle(opts.db, plate);
      switch (result.status) {
        case "unknown_plate":
          return reply.code(404).send({ error: "Not Found", message: `No registration found for ${plate}` });
        case "no_matching_version":
          return reply
            .code(422)
            .send({ error: "Unprocessable Entity", message: `${plate} is registered but matches no catalogue version` });
        case "found":
          return result.vehicle;
      }
    },
  );
}
