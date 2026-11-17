/** GET /health: is the service up, and can it read the database? */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";

export async function healthRoutes(app: FastifyInstance, opts: { db: DB }) {
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Service health check",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["ok"] },
              versions: { type: "integer", description: "Rows in the reference catalogue" },
              listings: { type: "integer" },
            },
            required: ["status", "versions", "listings"],
          },
        },
      },
    },
    async () => {
      const count = (table: string) =>
        (opts.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      return { status: "ok", versions: count("versions"), listings: count("listings") };
    },
  );
}
