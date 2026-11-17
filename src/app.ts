/**
 * buildApp() creates the Fastify app without starting a server.
 * Tests call it with an in-memory database; server.ts calls it with the real file.
 */
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import type { DB } from "./db";
import { requireToken } from "./auth";
import { healthRoutes } from "./routes/health";
import { feedsRoutes } from "./routes/feeds";
import { vehiclesRoutes } from "./routes/vehicles";

export interface AppOptions {
  db: DB;
  apiToken: string;
  logger?: boolean;
  /** Serve the interactive Swagger page at /docs (off in tests: it is only for humans). */
  docsUi?: boolean;
}

export async function buildApp({ db, apiToken, logger = false, docsUi = false }: AppOptions) {
  const app = Fastify({ logger });

  // OpenAPI spec is generated from each route's schema. QA Pilot (Phase 2) reads it.
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Mini La Centrale API",
        version: "0.1.0",
        description: "Small fake car-marketplace backend used as a QA playground.",
      },
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
    },
  });
  if (docsUi) {
    const { default: swaggerUi } = await import("@fastify/swagger-ui");
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }
  // Machine-readable spec, always available (tests and QA Pilot use this).
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  // Shared helper so every write route uses the same auth check.
  app.decorate("requireToken", requireToken(apiToken));

  await app.register(healthRoutes, { db });
  await app.register(feedsRoutes, { db }); // Module 1: stock import
  await app.register(vehiclesRoutes, { db }); // Module 2: plate lookup
  // Next module: search

  await app.ready();
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    requireToken: ReturnType<typeof requireToken>;
  }
}
