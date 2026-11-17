/**
 * Token auth for write endpoints.
 *
 * Clients send:  Authorization: Bearer <token>
 * Missing or wrong token -> 401. Read endpoints stay public (like a real marketplace).
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/** Compare in constant time so an attacker can't guess the token from response timing. */
function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build a Fastify preHandler that rejects requests without the right token. */
export function requireToken(expectedToken: string) {
  return async function checkToken(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token || !sameToken(token, expectedToken)) {
      return reply.code(401).send({ error: "Unauthorized", message: "Missing or invalid API token" });
    }
  };
}
