import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { requireApiKey } from "./auth.js";
import { productCache } from "./cache.js";
import { getProvider, providerStatus } from "./providers/registry.js";
import { providerNames, type ProductSearchResult, type NormalizedProduct } from "./types/product.js";
import { recordUsage, usageSummary } from "./usage.js";

const providerSchema = z.enum(providerNames);

export async function buildApp() {
  const app = Fastify({ logger: true });
  app.decorateRequest("apiClient", null);

  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  await app.register(rateLimit, { max: config.DEFAULT_RATE_LIMIT, timeWindow: config.DEFAULT_RATE_WINDOW });

  app.get("/", async () => ({ name: "Bazunk Data API", version: "v1", status: "ok" }));
  app.get("/health", async () => ({
    status: "ok", providers: providerStatus(), timestamp: new Date().toISOString()
  }));

  app.register(async (v1) => {
    v1.addHook("preHandler", requireApiKey);

    v1.get("/me", async (request) => ({ client: request.apiClient }));
    v1.get("/usage", async (request) => usageSummary(request.apiClient!.id));
    v1.get("/providers", async (request) => {
      recordUsage({ clientId: request.apiClient!.id, route: "/v1/providers", timestamp: new Date().toISOString() });
      return { providers: providerStatus() };
    });

    v1.get("/products/search", async (request, reply) => {
      const parsed = z.object({
        provider: providerSchema,
        q: z.string().trim().min(1).max(200),
        page: z.coerce.number().int().positive().default(1),
        country: z.string().trim().min(2).max(3).optional(),
        currency: z.string().trim().length(3).optional()
      }).safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

      const p = parsed.data;
      const provider = getProvider(p.provider);
      if (!provider.isConfigured()) return reply.code(503).send({ error: "provider_unavailable", provider: p.provider });

      const cacheKey = `search:${p.provider}:${p.country ?? ""}:${p.currency ?? ""}:${p.page}:${p.q.toLowerCase()}`;
      const cached = productCache.get<ProductSearchResult>(cacheKey);
      recordUsage({ clientId: request.apiClient!.id, route: "/v1/products/search", provider: p.provider, timestamp: new Date().toISOString(), cacheHit: Boolean(cached) });
      if (cached) return { ...cached, meta: { cache: "hit" } };

      const result = await provider.search({ query: p.q, page: p.page, country: p.country, currency: p.currency });
      productCache.set(cacheKey, result);
      return { ...result, meta: { cache: "miss" } };
    });

    v1.get("/products/:provider/:externalId", async (request, reply) => {
      const params = z.object({
        provider: providerSchema,
        externalId: z.string().trim().min(1).max(200)
      }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_request" });

      const p = params.data;
      const provider = getProvider(p.provider);
      if (!provider.isConfigured()) return reply.code(503).send({ error: "provider_unavailable", provider: p.provider });

      const cacheKey = `product:${p.provider}:${p.externalId}`;
      const cached = productCache.get<NormalizedProduct>(cacheKey);
      recordUsage({ clientId: request.apiClient!.id, route: "/v1/products/:provider/:externalId", provider: p.provider, timestamp: new Date().toISOString(), cacheHit: Boolean(cached) });
      if (cached) return { ...cached, meta: { cache: "hit" } };

      const product = await provider.getProduct(p.externalId);
      if (!product) return reply.code(404).send({ error: "not_found" });
      productCache.set(cacheKey, product);
      return { ...product, meta: { cache: "miss" } };
    });
  }, { prefix: "/v1" });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({ error: "internal_error", message: "The request could not be completed." });
  });
  return app;
}
