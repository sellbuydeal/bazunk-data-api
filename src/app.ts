import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { requireApiKey, requireScope } from "./auth.js";
import { productCache } from "./cache.js";
import { getProvider, providerStatus } from "./providers/registry.js";
import { providerNames, type ProductSearchResult, type NormalizedProduct } from "./types/product.js";
import { recordUsage, usageSummary } from "./usage.js";
import { issueKey, listKeys, revokeKey } from "./clients.js";

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
    v1.get("/usage", { preHandler: requireScope("usage:read") }, async (request) => usageSummary(request.apiClient!.id));
    v1.get("/keys", { preHandler: requireScope("keys:manage") }, async (request, reply) => {
      if (!/^[0-9a-f-]{36}$/i.test(request.apiClient!.id)) return reply.code(409).send({ error: "client_not_persisted" });
      return { keys: await listKeys(request.apiClient!.id) };
    });
    v1.post("/keys", { preHandler: requireScope("keys:manage") }, async (request, reply) => {
      if (!/^[0-9a-f-]{36}$/i.test(request.apiClient!.id)) return reply.code(409).send({ error: "client_not_persisted" });
      const parsed=z.object({label:z.string().trim().min(1).max(80).default("default"),scopes:z.array(z.enum(["products:read","providers:read","usage:read"])).min(1).default(["products:read","providers:read","usage:read"])}).safeParse(request.body??{});
      if(!parsed.success)return reply.code(400).send({error:"invalid_request",details:parsed.error.flatten()});
      const created=await issueKey(request.apiClient!.id,parsed.data.label,parsed.data.scopes);
      return reply.code(201).send({...created,warning:"Copy this key now. It will not be shown again."});
    });
    v1.delete("/keys/:id", { preHandler: requireScope("keys:manage") }, async (request, reply) => {
      if (!/^[0-9a-f-]{36}$/i.test(request.apiClient!.id)) return reply.code(409).send({ error: "client_not_persisted" });
      const parsed=z.object({id:z.string().uuid()}).safeParse(request.params);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});
      const ok=await revokeKey(request.apiClient!.id,parsed.data.id);return ok?reply.code(204).send():reply.code(404).send({error:"not_found"});
    });

    v1.get("/providers", { preHandler: requireScope("providers:read") }, async (request) => {
      recordUsage({ clientId: request.apiClient!.id, route: "/v1/providers", timestamp: new Date().toISOString() });
      return { providers: providerStatus() };
    });

    v1.get("/products/search", { preHandler: requireScope("products:read") }, async (request, reply) => {
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

    v1.get("/products/:provider/:externalId", { preHandler: requireScope("products:read") }, async (request, reply) => {
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
