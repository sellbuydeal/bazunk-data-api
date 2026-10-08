import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { requireApiKey, requireScope } from "./auth.js";
import { productCache } from "./cache.js";
import { getProvider, providerStatus } from "./providers/registry.js";
import { providerNames, type ProductSearchResult, type NormalizedProduct } from "./types/product.js";
import { recordUsage, usageSummary, adminUsageSummary } from "./usage.js";
import { issueKey, listKeys, revokeKey, listClients, createClient, setClientActive, getOrCreateClerkClient, updateClientAdmin } from "./clients.js";
import { createClerkClient, verifyToken } from "@clerk/backend";

const providerSchema = z.enum(providerNames);

export async function buildApp() {
  const app = Fastify({ logger: true });
  app.decorateRequest("apiClient", null);

  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  await app.register(rateLimit, { max: config.DEFAULT_RATE_LIMIT, timeWindow: config.DEFAULT_RATE_WINDOW });

  app.get("/", async () => ({ name: "Bazunk Data API", version: "v1", status: "ok" }));
  const clerk=config.CLERK_SECRET_KEY?createClerkClient({secretKey:config.CLERK_SECRET_KEY}):null;
  async function webClient(request:any,reply:any){if(!clerk)return reply.code(503).send({error:"web_auth_unavailable"});const auth=request.headers.authorization;if(!auth?.startsWith("Bearer "))return reply.code(401).send({error:"unauthorized"});try{const claims=await verifyToken(auth.slice(7),{secretKey:config.CLERK_SECRET_KEY!});const user=await clerk.users.getUser(claims.sub);const primary=user.primaryEmailAddress;const email=primary?.emailAddress??user.emailAddresses[0]?.emailAddress??"Bazunk developer";const verified=primary?.verification?.status==="verified";const client=await getOrCreateClerkClient(claims.sub,email,verified);request.webClient=client;}catch{return reply.code(401).send({error:"unauthorized"});}}
  app.get("/web/account",{preHandler:webClient},async(request:any)=>{const client=request.webClient;return{client,keys:await listKeys(client.id),usage:await usageSummary(client.id)};});
  app.post("/web/keys",{preHandler:webClient},async(request:any,reply)=>{const client=request.webClient;const parsed=z.object({label:z.string().trim().min(1).max(80).default("default")}).safeParse(request.body??{});if(!parsed.success)return reply.code(400).send({error:"invalid_request"});const created=await issueKey(client.id,parsed.data.label,["products:read","providers:read","usage:read"]);return reply.code(201).send({...created,warning:"Copy this key now. It will not be shown again."});});
  app.delete("/web/keys/:id",{preHandler:webClient},async(request:any,reply)=>{const client=request.webClient;const parsed=z.object({id:z.string().uuid()}).safeParse(request.params);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});return await revokeKey(client.id,parsed.data.id)?reply.code(204).send():reply.code(404).send({error:"not_found"});});
  app.post("/web/self-test",{preHandler:webClient},async(request:any,reply)=>{const client=request.webClient;const before=await usageSummary(client.id);const created=await issueKey(client.id,"Automatic E2E test",["providers:read"]);try{const first=await app.inject({method:"GET",url:"/v1/providers",headers:{"x-api-key":created.key}});await new Promise(r=>setTimeout(r,250));const after=await usageSummary(client.id);const revoked=await revokeKey(client.id,created.id);const second=await app.inject({method:"GET",url:"/v1/providers",headers:{"x-api-key":created.key}});const usageBefore=before.month_requests??0,usageAfter=after.month_requests??0;const passed=first.statusCode===200&&usageAfter>usageBefore&&revoked&&second.statusCode===401;return{passed,steps:{create:"passed",apiCall:{passed:first.statusCode===200,status:first.statusCode},usage:{passed:usageAfter>usageBefore,before:usageBefore,after:usageAfter},revoke:{passed:revoked},rejectedAfterRevoke:{passed:second.statusCode===401,status:second.statusCode}}};}catch(e){await revokeKey(client.id,created.id).catch(()=>false);request.log.error(e);return reply.code(500).send({passed:false,error:"self_test_failed"});}});
  app.get("/web/admin/overview",{preHandler:webClient},async(request:any,reply)=>{const client=request.webClient;if(client.plan!=="internal")return reply.code(403).send({error:"forbidden"});const clients=await listClients();const settings=await (await import("./db.js")).db!.query("SELECT default_currency FROM platform_settings WHERE id=1");const database=(await import("./db.js")).db!;const plans=await database.query("SELECT plan,monthly_quota,rate_limit_per_minute,prices,active FROM billing_plans ORDER BY plan");return{stats:{customers:clients.filter((x:any)=>x.plan!=="internal").length,activeCustomers:clients.filter((x:any)=>x.plan!=="internal"&&x.active).length,developer:clients.filter((x:any)=>x.plan==="developer").length,commercial:clients.filter((x:any)=>x.plan==="commercial").length},clients,providers:providerStatus(),plans:plans.rows,settings:{defaultCurrency:settings.rows[0]?.default_currency??"GBP",supportedCurrencies:["GBP","USD","EUR","AUD","CAD"]}};});
  app.get("/web/admin/usage",{preHandler:webClient},async(request:any,reply)=>{if(request.webClient.plan!=="internal")return reply.code(403).send({error:"forbidden"});return await adminUsageSummary();});
  app.get("/web/admin/health",{preHandler:webClient},async(request:any,reply)=>{if(request.webClient.plan!=="internal")return reply.code(403).send({error:"forbidden"});const started=Date.now();const database=(await import("./db.js")).db;let databaseStatus="unavailable",databaseMs:null as number|null;try{if(database){const t=Date.now();await database.query("SELECT 1");databaseMs=Date.now()-t;databaseStatus="online"}}catch{databaseStatus="error"}return{api:"online",apiUptimeSeconds:Math.round(process.uptime()),database:databaseStatus,databaseMs,providers:providerStatus(),checkedAt:new Date().toISOString(),responseMs:Date.now()-started};});
  app.patch("/web/admin/settings",{preHandler:webClient},async(request:any,reply)=>{const admin=request.webClient;if(admin.plan!=="internal")return reply.code(403).send({error:"forbidden"});const b=z.object({defaultCurrency:z.enum(["GBP","USD","EUR","AUD","CAD"])}).safeParse(request.body??{});if(!b.success)return reply.code(400).send({error:"invalid_request"});const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("UPDATE platform_settings SET default_currency=$1,updated_at=now() WHERE id=1 RETURNING default_currency",[b.data.defaultCurrency]);return{settings:{defaultCurrency:r.rows[0].default_currency,supportedCurrencies:["GBP","USD","EUR","AUD","CAD"]}};});
  app.patch("/web/admin/plans/:plan",{preHandler:webClient},async(request:any,reply)=>{const admin=request.webClient;if(admin.plan!=="internal")return reply.code(403).send({error:"forbidden"});const p=z.object({plan:z.enum(["developer","commercial"])}).safeParse(request.params),b=z.object({monthlyQuota:z.number().int().min(0).max(100000000),rateLimitPerMinute:z.number().int().min(1).max(10000),prices:z.object({GBP:z.number().min(0),USD:z.number().min(0),EUR:z.number().min(0),AUD:z.number().min(0),CAD:z.number().min(0)}),active:z.boolean().default(true)}).safeParse(request.body??{});if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("UPDATE billing_plans SET monthly_quota=$2,rate_limit_per_minute=$3,prices=$4::jsonb,active=$5,updated_at=now() WHERE plan=$1 RETURNING plan,monthly_quota,rate_limit_per_minute,prices,active",[p.data.plan,b.data.monthlyQuota,b.data.rateLimitPerMinute,JSON.stringify(b.data.prices),b.data.active]);return{plan:r.rows[0]};});
  app.get("/web/plans",{preHandler:webClient},async()=>{const database=(await import("./db.js")).db;if(!database)return{plans:[],defaultCurrency:"GBP"};const [plans,settings]=await Promise.all([database.query("SELECT plan,monthly_quota,rate_limit_per_minute,prices,active FROM billing_plans WHERE active=true ORDER BY plan"),database.query("SELECT default_currency FROM platform_settings WHERE id=1")]);return{plans:plans.rows,defaultCurrency:settings.rows[0]?.default_currency??"GBP",supportedCurrencies:["GBP","USD","EUR","AUD","CAD"]};});
  app.patch("/web/admin/clients/:id",{preHandler:webClient},async(request:any,reply)=>{const admin=request.webClient;if(admin.plan!=="internal")return reply.code(403).send({error:"forbidden"});const p=z.object({id:z.string().uuid()}).safeParse(request.params),b=z.object({plan:z.enum(["developer","commercial"]).optional(),monthlyQuota:z.number().int().min(0).max(100000000).optional(),rateLimitPerMinute:z.number().int().min(1).max(10000).optional(),active:z.boolean().optional()}).safeParse(request.body??{});if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const client=await updateClientAdmin(p.data.id,b.data);return client?{client}:reply.code(404).send({error:"not_found"});});
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

    v1.get("/admin/clients", { preHandler: requireScope("clients:manage") }, async () => ({ clients: await listClients() }));
    v1.post("/admin/clients", { preHandler: requireScope("clients:manage") }, async (request, reply) => { const parsed=z.object({name:z.string().trim().min(2).max(120),plan:z.enum(["developer","commercial"]).default("developer"),monthlyQuota:z.number().int().min(0).max(100000000).default(1000),rateLimitPerMinute:z.number().int().min(1).max(10000).default(60)}).safeParse(request.body??{});if(!parsed.success)return reply.code(400).send({error:"invalid_request",details:parsed.error.flatten()});const client=await createClient(parsed.data);const created=await issueKey(client.id,"Primary",["products:read","providers:read","usage:read"]);return reply.code(201).send({client,apiKey:created.key,keyPrefix:created.keyPrefix,warning:"Copy this API key now. It will not be shown again."}); });
    v1.patch("/admin/clients/:id", { preHandler: requireScope("clients:manage") }, async (request, reply) => { const p=z.object({id:z.string().uuid()}).safeParse(request.params),b=z.object({active:z.boolean()}).safeParse(request.body??{});if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const client=await setClientActive(p.data.id,b.data.active);return client?{client}:reply.code(404).send({error:"not_found"}); });

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
        currency: z.string().trim().length(3).optional(),
        store: z.string().trim().min(3).max(253).optional()
      }).safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

      const p = parsed.data;
      const provider = getProvider(p.provider);
      if (!provider.isConfigured()) return reply.code(503).send({ error: "provider_unavailable", provider: p.provider });

      const cacheKey = `search:${p.provider}:${p.store ?? ""}:${p.country ?? ""}:${p.currency ?? ""}:${p.page}:${p.q.toLowerCase()}`;
      const cached = productCache.get<ProductSearchResult>(cacheKey);
      recordUsage({ clientId: request.apiClient!.id, route: "/v1/products/search", provider: p.provider, timestamp: new Date().toISOString(), cacheHit: Boolean(cached) });
      if (cached) return { ...cached, meta: { cache: "hit" } };

      const result = await provider.search({ query: p.q, page: p.page, country: p.country, currency: p.currency, store: p.store });
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
