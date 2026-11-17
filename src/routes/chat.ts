/**
 * POST /chat: a buyer asks a question about one listing.
 *
 * Needs a token: only signed-in buyers can chat (and answers can cost money).
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { loadChatFacts, type ChatWriter } from "../chat";

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" }, message: { type: "string" } },
} as const;

export async function chatRoutes(app: FastifyInstance, opts: { db: DB; writer: ChatWriter }) {
  app.post<{ Body: { listingId: number; question: string } }>(
    "/chat",
    {
      onRequest: app.requireToken,
      schema: {
        tags: ["chat"],
        summary: "Ask a question about a car for sale",
        description:
          "Answers only from the car's data (price, mileage, year, motorisation, equipment, location). " +
          "When the answer isn't in the data, it says so and suggests contacting the seller. " +
          "A car that has been sold can't be discussed anymore: 410.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["listingId", "question"],
          additionalProperties: false,
          properties: {
            listingId: { type: "integer", minimum: 1 },
            question: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              listingId: { type: "integer" },
              question: { type: "string" },
              answer: { type: "string" },
              facts: {
                type: "object",
                properties: {
                  listingId: { type: "integer" },
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
                  city: { type: "string" },
                  dealerName: { type: "string" },
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
          410: errorSchema,
          502: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { listingId, question } = request.body;
      const facts = loadChatFacts(opts.db, listingId);
      if (!facts) {
        return reply.code(404).send({ error: "Not Found", message: `Unknown listing: ${listingId}` });
      }
      try {
        const answer = await opts.writer.answer(facts, question.trim());
        return { listingId, question, answer, facts, writer: { type: opts.writer.type, model: opts.writer.model } };
      } catch (err) {
        request.log.error(err);
        return reply.code(502).send({ error: "Bad Gateway", message: "The chat is unavailable, try again later" });
      }
    },
  );
}
