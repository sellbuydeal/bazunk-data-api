import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { requireApiKey } from "./auth.js";
import { getProvider, providerStatus } from "./providers/registry.js";
import { providerNames } from "./types/product.js";

const providerSchema = z.enum(providerNames);

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false
  });

  await app.register(rateLimit, {
    max: config.DEFAULT_RATE_LIMIT,
    timeWindow: config.DEFAULT_RATE_WINDOW
  });

  app.get("/", async () => ({
    name: "Bazunk Data API",
    version: "v1",
    status: "ok"
  }));

  app.get("/health", async () => ({
    status: "ok",
    providers: providerStatus(),
    timestamp: new Date().toISOString()
  }));

  app.register(async (v1) => {
    v1.addHook("preHandler", requireApiKey);

    v1.get("/providers", async () => ({ providers: providerStatus() }));

    v1.get("/products/search", async (request, reply) => {
      const parsed = z.object({
        provider: providerSchema,
        q: z.string().trim().min(1).max(200),
        page: z.coerce.number().int().positive().default(1),
        country: z.string().trim().min(2).max(3).optional(),
        currency: z.string().trim().length(3).optional()
      }).safeParse(request.query);

      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

      const provider = getProvider(parsed.data.provider);
      if (!provider.isConfigured()) {
        return reply.code(503).send({ error: "provider_unavailable", provider: parsed.data.provider });
      }

      return provider.search({
        query: parsed.data.q,
        page: parsed.data.page,
        country: parsed.data.country,
        currency: parsed.data.currency
      });
    });

    v1.get("/products/:provider/:externalId", async (request, reply) => {
      const params = z.object({
        provider: providerSchema,
        externalId: z.string().trim().min(1).max(200)
      }).safeParse(request.params);

      if (!params.success) return reply.code(400).send({ error: "invalid_request" });

      const provider = getProvider(params.data.provider);
      if (!provider.isConfigured()) return reply.code(503).send({ error: "provider_unavailable", provider: params.data.provider });

      const product = await provider.getProduct(params.data.externalId);
      if (!product) return reply.code(404).send({ error: "not_found" });
      return product;
    });
  }, { prefix: "/v1" });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({ error: "internal_error", message: "The request could not be completed." });
  });

  return app;
}
