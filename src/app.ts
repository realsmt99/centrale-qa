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
import { searchRoutes } from "./routes/search";
import { dealerSyncRoutes } from "./routes/dealer-sync";
import { pricingRoutes } from "./routes/pricing";
import { listingsRoutes } from "./routes/listings";
import { TemplateListingWriter, type ListingWriter } from "./listing-writer";
import { chatRoutes } from "./routes/chat";
import { TemplateChatWriter, type ChatWriter } from "./chat";

export interface AppOptions {
  db: DB;
  apiToken: string;
  logger?: boolean;
  /** Serve the interactive Swagger page at /docs (off in tests: it is only for humans). */
  docsUi?: boolean;
  /** Who writes ads. Default: the free template writer (so tests never call a paid API). */
  listingWriter?: ListingWriter;
  /** Who answers buyers' questions. Default: the free template writer. */
  chatWriter?: ChatWriter;
}

export async function buildApp({
  db,
  apiToken,
  logger = false,
  docsUi = false,
  listingWriter = new TemplateListingWriter(),
  chatWriter = new TemplateChatWriter(),
}: AppOptions) {
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
  await app.register(searchRoutes, { db }); // Module 3: search
  await app.register(dealerSyncRoutes, { db }); // unreliable upstream (flaky on purpose)
  await app.register(pricingRoutes, { db }); // Phase 3: price estimate
  await app.register(listingsRoutes, { db, writer: listingWriter }); // Phase 3: AI ad writer
  await app.register(chatRoutes, { db, writer: chatWriter }); // Phase 3: AI chat

  await app.ready();
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    requireToken: ReturnType<typeof requireToken>;
  }
}
