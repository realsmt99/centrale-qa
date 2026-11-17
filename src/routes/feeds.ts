/**
 * POST /feeds/import?dealerId=D001
 *
 * Accepts a dealer's full stock as JSON ({ "cars": [...] }) or CSV (text/csv,
 * one car per line). Both formats go through the same JSON schema, so the
 * same validation rules apply to both.
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { duplicateRefs, importStock, unknownVersionIds, type FeedCar } from "../stock";

const PLATE_PATTERN = "^[A-HJ-NP-TV-Z]{2}-[0-9]{3}-[A-HJ-NP-TV-Z]{2}$"; // AB-123-CD, no I/O/U

const carSchema = {
  type: "object",
  required: ["externalRef", "versionId", "year", "mileageKm", "price"],
  additionalProperties: false,
  properties: {
    externalRef: { type: "string", minLength: 1, maxLength: 64, description: "The car's ID in the dealer's software" },
    versionId: { type: "integer", minimum: 1, description: "ID from the reference catalogue" },
    plate: { type: "string", pattern: PLATE_PATTERN },
    year: { type: "integer", minimum: 1990 },
    mileageKm: { type: "integer", minimum: 0 },
    price: { type: "integer", description: "Asking price in euros" },
    color: { type: "string", maxLength: 30 },
  },
} as const;

const importResultSchema = {
  type: "object",
  properties: {
    dealerId: { type: "string" },
    received: { type: "integer" },
    created: { type: "integer" },
    updated: { type: "integer" },
    unchanged: { type: "integer" },
    markedSold: { type: "integer" },
  },
} as const;

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" }, message: { type: "string" }, details: {} },
} as const;

const CSV_COLUMNS = ["externalRef", "versionId", "plate", "year", "mileageKm", "price", "color"];

/** Minimal CSV reader: header line + one car per line, comma-separated, no quoted fields. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const unknown = header.filter((h) => !CSV_COLUMNS.includes(h));
  if (unknown.length > 0) throw new Error(`Unknown CSV column(s): ${unknown.join(", ")}`);

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((column, i) => {
      const value = values[i]?.trim();
      if (value) row[column] = value; // empty cell = field not provided
    });
    return row;
  });
}

export async function feedsRoutes(app: FastifyInstance, opts: { db: DB }) {
  const { db } = opts;

  // CSV body -> { cars: [...] }, then the normal JSON schema validates it.
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, { cars: parseCsv(body as string) });
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  app.post<{ Querystring: { dealerId: string }; Body: { cars: FeedCar[] } }>(
    "/feeds/import",
    {
      // Auth runs on "onRequest", BEFORE the body is read or validated:
      // a caller without a token learns nothing about our validation rules.
      onRequest: app.requireToken,
      bodyLimit: 10 * 1024 * 1024,
      schema: {
        tags: ["feeds"],
        summary: "Import a dealer's full stock (JSON or CSV)",
        description:
          "The feed is the dealer's complete current stock. New cars are created, " +
          "changed cars are updated, and active cars missing from the feed are marked sold.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          required: ["dealerId"],
          properties: { dealerId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["cars"],
          properties: { cars: { type: "array", items: carSchema, maxItems: 50_000 } },
        },
        response: { 200: importResultSchema, 400: errorSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const { dealerId } = request.query;
      const { cars } = request.body;

      const dealer = db.prepare("SELECT id FROM dealers WHERE id = ?").get(dealerId);
      if (!dealer) {
        return reply.code(404).send({ error: "Not Found", message: `Unknown dealer: ${dealerId}` });
      }

      const dupes = duplicateRefs(cars);
      if (dupes.length > 0) {
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "Same externalRef used more than once in the feed", details: dupes });
      }

      const unknown = unknownVersionIds(db, cars);
      if (unknown.length > 0) {
        return reply
          .code(400)
          .send({ error: "Bad Request", message: "Unknown versionId(s) in the feed", details: unknown });
      }

      return importStock(db, dealerId, cars);
    },
  );
}
