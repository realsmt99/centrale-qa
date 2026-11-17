/**
 * GET /dealer-sync/status: when did each dealer's stock last sync?
 *
 * In real life this would call the dealers' own software, which we don't
 * control and which sometimes times out. We simulate that unreliable upstream
 * service: a share of calls (DEALER_SYNC_FAILURE_RATE, default 15%) fail with 503.
 * Tests that call this endpoint are "flaky": same code, different results.
 */
import type { FastifyInstance } from "fastify";
import type { DB } from "../db";

export async function dealerSyncRoutes(app: FastifyInstance, opts: { db: DB; failureRate?: number }) {
  const failureRate = opts.failureRate ?? Number(process.env.DEALER_SYNC_FAILURE_RATE ?? 0.15);

  app.get(
    "/dealer-sync/status",
    {
      schema: {
        tags: ["dealer-sync"],
        summary: "Last stock sync per dealer (depends on an unreliable upstream service)",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["ok"] },
              dealers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    dealerId: { type: "string" },
                    activeListings: { type: "integer" },
                    lastSyncAt: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          503: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (_request, reply) => {
      if (Math.random() < failureRate) {
        return reply.code(503).send({ error: "Service Unavailable", message: "Upstream dealer sync timed out" });
      }
      const dealers = opts.db
        .prepare(`
          SELECT d.id AS dealerId,
                 COUNT(l.id) AS activeListings,
                 MAX(l.updated_at) AS lastSyncAt
          FROM dealers d
          LEFT JOIN listings l ON l.dealer_id = d.id AND l.status = 'active'
          GROUP BY d.id ORDER BY d.id`)
        .all();
      return { status: "ok", dealers };
    },
  );
}
