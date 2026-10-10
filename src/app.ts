import { beginAliExpressAuthorization, completeAliExpressAuthorization, aliexpressAuthorizationStatus } from "./aliexpress-oauth.js";
import { officialConfigured, officialSearch, officialSearchDiagnostics, officialCompareSearches, officialRepeatSearchDiagnostic, officialSearchParameterProbe, officialProduct } from "./providers/aliexpress/official-api.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { requireApiKey, requireScope } from "./auth.js";
import { productCache } from "./cache.js";
import { getProvider, providerStatus } from "./providers/registry.js";
import { providerNames, type ProductSearchResult, type NormalizedProduct } from "./types/product.js";
import { recordUsage, usageSummary, adminUsageSummary, recentActivity } from "./usage.js";
import { issueKey, listKeys, revokeKey, listClients, createClient, setClientActive, getOrCreateClerkClient, updateClientAdmin } from "./clients.js";
import { createClerkClient, verifyToken } from "@clerk/backend";

const providerSchema = z.enum(providerNames);

export async function buildApp() {
  const app = Fastify({ logger: true });
  app.decorateRequest("apiClient", null);

  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  await app.register(rateLimit, { max: 10000, timeWindow: config.DEFAULT_RATE_WINDOW }); // coarse abuse ceiling; authenticated API limits are enforced per client in requireApiKey

  app.get("/", async () => ({ name: "Bazunk Data API", version: "v1", status: "ok" }));
  const clerk=config.CLERK_SECRET_KEY?createClerkClient({secretKey:config.CLERK_SECRET_KEY}):null;
  async function webClient(request:any,reply:any){if(!clerk)return reply.code(503).send({error:"web_auth_unavailable",message:"Authentication service is not configured."});const auth=request.headers.authorization;if(!auth?.startsWith("Bearer "))return reply.code(401).send({error:"unauthorized",message:"Sign in is required."});try{const claims=await verifyToken(auth.slice(7),{secretKey:config.CLERK_SECRET_KEY!});const user=await clerk.users.getUser(claims.sub);const primary=user.primaryEmailAddress;const email=primary?.emailAddress??user.emailAddresses[0]?.emailAddress??"Bazunk developer";const verified=primary?.verification?.status==="verified";const client=await getOrCreateClerkClient(claims.sub,email,verified);request.webClient=client;request.webIdentity={email,verified};}catch{return reply.code(401).send({error:"unauthorized",message:"Your session could not be verified."});}}
  async function internalAdmin(request:any,reply:any){const auth=request.headers.authorization;if(!auth?.startsWith("Bearer "))return reply.code(401).send({error:"unauthorized",message:"Bazunk Admin authentication is required."});try{const r=await fetch("https://bazunk-api.onrender.com/api/admin/settings",{headers:{Authorization:auth},signal:AbortSignal.timeout(10000)});if(!r.ok)return reply.code(401).send({error:"unauthorized",message:"Bazunk Admin session is invalid or expired."});request.webClient={id:"bazunk-admin",name:"Bazunk Admin",plan:"internal"};}catch{return reply.code(502).send({error:"admin_auth_unavailable",message:"Bazunk Admin authentication is temporarily unavailable."})}}
  app.post("/web/admin/login",async(request:any,reply)=>{const b=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(request.body??{});if(!b.success)return reply.code(400).send({error:"invalid_request"});try{const r=await fetch("https://bazunk-api.onrender.com/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b.data),signal:AbortSignal.timeout(12000)});if(!r.ok)return reply.code(401).send({error:"invalid_credentials",message:"Invalid Bazunk admin email or password."});const data:any=await r.json();if(typeof data.token!=="string"||!data.token)return reply.code(502).send({error:"admin_auth_failed"});return{token:data.token,expiresIn:86400}}catch{return reply.code(502).send({error:"admin_auth_unavailable",message:"Bazunk Admin authentication is temporarily unavailable."})}});
  app.get("/web/admin/session",{preHandler:internalAdmin},async()=>({ok:true}));
  app.get("/web/account",{preHandler:webClient},async(request:any)=>{const client=request.webClient;return{client,keys:await listKeys(client.id),usage:await usageSummary(client.id),recentActivity:await recentActivity(client.id)};});
  app.patch("/web/preferences",{preHandler:webClient},async(request:any,reply)=>{const b=z.object({currency:z.enum(["GBP","USD","EUR","AUD","CAD"])}).safeParse(request.body??{});if(!b.success)return reply.code(400).send({error:"invalid_request"});const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});await database.query("UPDATE api_clients SET preferred_currency=$2 WHERE id=$1",[request.webClient.id,b.data.currency]);return{currency:b.data.currency};});
  app.get("/web/admin/aliexpress/connect",{preHandler:internalAdmin},async(request:any,reply)=>{try{return {authorizationUrl:await beginAliExpressAuthorization()};}catch(e){request.log.error(e);return reply.code(503).send({error:"aliexpress_oauth_unavailable"});}});
  app.get("/internal/aliexpress/oauth/callback",async(request:any,reply)=>{const expected=process.env.ALIEXPRESS_INTERNAL_TOKEN;const supplied=request.headers["x-internal-token"];if(!expected||supplied!==expected)return reply.code(401).send({error:"unauthorized"});const query=z.object({code:z.string(),state:z.string()}).safeParse(request.query);if(!query.success)return reply.code(400).send({error:"invalid_callback"});try{await completeAliExpressAuthorization(query.data.code,query.data.state);return {connected:true};}catch(e){request.log.error(e);return reply.code(400).send({error:"authorization_failed"});}});
  app.get("/web/admin/aliexpress/oauth-status",{preHandler:internalAdmin},async()=>({authorized:await aliexpressAuthorizationStatus()}));
  app.get("/web/admin/aliexpress/test-search",{preHandler:internalAdmin},async(request:any,reply)=>{
    if(!await aliexpressAuthorizationStatus())return reply.code(409).send({error:"not_authorized"});
    const parsed=z.object({q:z.string().trim().min(1).max(120).default("phone case")}).safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:"invalid_query"});
    try {
      const result=await officialSearch({query:parsed.data.q,page:1,currency:"GBP",country:"GB"});
      return {ok:true,query:result.query,count:result.items.length,products:result.items.slice(0,5).map(p=>({id:p.externalId,title:p.title,price:p.price,image:p.images[0]?.url,sourceUrl:p.sourceUrl})),message:result.items.length?"Live AliExpress search returned products":"AliExpress responded, but no valid products were parsed"};
    }catch(e:any){
      request.log.error({err:e},"AliExpress live search test failed");
      return reply.code(502).send({error:"search_failed",detail:String(e?.message||"AliExpress request failed").slice(0,200)});
    }
  });

  app.get("/web/admin/aliexpress/parameter-probe",{preHandler:internalAdmin},async(request:any,reply)=>{
    try{return await officialSearchParameterProbe(String(request.query?.q??"phone case"));}
    catch(e:any){request.log.error({err:e},"AliExpress parameter probe failed");return reply.code(502).send({error:"parameter_probe_failed",detail:String(e?.message||"Request failed").slice(0,200)});}
  });
  app.get("/web/admin/aliexpress/repeat-search",{preHandler:internalAdmin},async(request:any,reply)=>{
    try{return await officialRepeatSearchDiagnostic(String(request.query?.q??"phone case"));}
    catch(e:any){request.log.error({err:e},"AliExpress repeat search failed");return reply.code(502).send({error:"repeat_search_failed",detail:String(e?.message||"Request failed").slice(0,200)});}
  });
  app.get("/web/admin/aliexpress/compare-searches",{preHandler:internalAdmin},async(request:any,reply)=>{
    try{return await officialCompareSearches(["phone case","disco lights","women shoes"]);}
    catch(e:any){request.log.error({err:e},"AliExpress comparison failed");return reply.code(502).send({error:"comparison_failed",detail:String(e?.message||"Request failed").slice(0,200)});}
  });
  app.get("/web/admin/aliexpress/search-diagnostics",{preHandler:internalAdmin},async(request:any,reply)=>{
    const parsed=z.object({q:z.string().trim().min(1).max(120).default("phone case")}).safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:"invalid_query"});
    try{return await officialSearchDiagnostics({query:parsed.data.q,page:1,currency:"GBP",country:"GB"});}
    catch(e:any){request.log.error({err:e},"AliExpress diagnostics failed");return reply.code(502).send({error:"diagnostics_failed",detail:String(e?.message||"Request failed").slice(0,200)});}
  });
  app.get("/web/aliexpress/status",{preHandler:webClient},async()=>({appCredentialsConfigured:officialConfigured(),accessTokenConfigured:await aliexpressAuthorizationStatus(),internalTokenConfigured:Boolean(process.env.ALIEXPRESS_INTERNAL_TOKEN),publicProviderEnabled:process.env.ALIEXPRESS_PROVIDER_ENABLED==="true",publicResaleLicenseConfirmed:process.env.ALIEXPRESS_RESALE_LICENSE_CONFIRMED==="true",publicSearchAvailable:getProvider("aliexpress").isConfigured(),note:"Credentials are never returned. OAuth tokens are stored encrypted in the database and refreshed when needed."}));
  app.post("/web/keys",{preHandler:webClient},async(request:any,reply)=>{const client=request.webClient;const parsed=z.object({label:z.string().trim().min(1).max(80).default("default")}).safeParse(request.body??{});if(!parsed.success)return reply.code(400).send({error:"invalid_request"});const created=await issueKey(client.id,parsed.data.label,["products:read","providers:read","usage:read"]);return reply.code(201).send({...created,warning:"Copy this key now. It will not be shown again."});});
  app.delete("/web/keys/:id",{preHandler:webClient},async(request:any,reply)=>{const client=request.webClient;const parsed=z.object({id:z.string().uuid()}).safeParse(request.params);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});return await revokeKey(client.id,parsed.data.id)?reply.code(204).send():reply.code(404).send({error:"not_found"});});
  app.post("/web/self-test",{preHandler:webClient},async(request:any,reply)=>{const client=request.webClient;const before=await usageSummary(client.id);const created=await issueKey(client.id,"Automatic E2E test",["providers:read"]);try{const first=await app.inject({method:"GET",url:"/v1/providers",headers:{"x-api-key":created.key}});await new Promise(r=>setTimeout(r,250));const after=await usageSummary(client.id);const revoked=await revokeKey(client.id,created.id);const second=await app.inject({method:"GET",url:"/v1/providers",headers:{"x-api-key":created.key}});const usageBefore=before.month_requests??0,usageAfter=after.month_requests??0;const passed=first.statusCode===200&&usageAfter>usageBefore&&revoked&&second.statusCode===401;return{passed,steps:{create:"passed",apiCall:{passed:first.statusCode===200,status:first.statusCode},usage:{passed:usageAfter>usageBefore,before:usageBefore,after:usageAfter},revoke:{passed:revoked},rejectedAfterRevoke:{passed:second.statusCode===401,status:second.statusCode}}};}catch(e){await revokeKey(client.id,created.id).catch(()=>false);request.log.error(e);return reply.code(500).send({passed:false,error:"self_test_failed"});}});
  app.get("/web/support/tickets",{preHandler:webClient},async(request:any,reply)=>{const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("SELECT id,subject,category,priority,status,message,admin_reply,created_at,updated_at FROM support_tickets WHERE client_id=$1 ORDER BY created_at DESC",[request.webClient.id]);return{tickets:r.rows};});
  app.post("/web/support/tickets",{preHandler:webClient},async(request:any,reply)=>{const b=z.object({subject:z.string().trim().min(3).max(160),category:z.enum(["api","billing","account","provider","bug","general"]).default("general"),priority:z.enum(["low","normal","high"]).default("normal"),message:z.string().trim().min(10).max(10000)}).safeParse(request.body??{});if(!b.success)return reply.code(400).send({error:"invalid_request",details:b.error.flatten()});const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("INSERT INTO support_tickets(client_id,subject,category,priority,message) VALUES($1,$2,$3,$4,$5) RETURNING id,subject,category,priority,status,message,created_at",[request.webClient.id,b.data.subject,b.data.category,b.data.priority,b.data.message]);return reply.code(201).send({ticket:r.rows[0]});});
  app.get("/web/admin/tickets",{preHandler:internalAdmin},async(request:any,reply)=>{const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("SELECT t.id,t.subject,t.category,t.priority,t.status,t.message,t.admin_reply,t.created_at,t.updated_at,c.name customer,c.plan FROM support_tickets t JOIN api_clients c ON c.id=t.client_id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,t.created_at DESC");return{tickets:r.rows};});
  app.patch("/web/admin/tickets/:id",{preHandler:internalAdmin},async(request:any,reply)=>{const p=z.object({id:z.string().uuid()}).safeParse(request.params),b=z.object({status:z.enum(["open","in_progress","resolved","closed"]).optional(),reply:z.string().trim().max(10000).optional()}).safeParse(request.body??{});if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("UPDATE support_tickets SET status=COALESCE($2,status),admin_reply=COALESCE($3,admin_reply),updated_at=now() WHERE id=$1 RETURNING id,status,admin_reply,updated_at",[p.data.id,b.data.status??null,b.data.reply??null]);return r.rowCount?{ticket:r.rows[0]}:reply.code(404).send({error:"not_found"});});
  app.get("/web/admin/overview",{preHandler:internalAdmin},async(request:any,reply)=>{const client=request.webClient;const clients=await listClients();const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const settings=await database.query("SELECT default_currency FROM platform_settings WHERE id=1");const plans=await database.query("SELECT plan,monthly_quota,rate_limit_per_minute,prices,active FROM billing_plans ORDER BY plan");return{stats:{customers:clients.filter((x:any)=>x.plan!=="internal").length,activeCustomers:clients.filter((x:any)=>x.plan!=="internal"&&x.active).length,developer:clients.filter((x:any)=>x.plan==="developer").length,commercial:clients.filter((x:any)=>x.plan==="commercial").length},clients,providers:providerStatus(),plans:plans.rows,settings:{defaultCurrency:settings.rows[0]?.default_currency??"GBP",supportedCurrencies:["GBP","USD","EUR","AUD","CAD"]}};});
  app.get("/web/admin/usage",{preHandler:internalAdmin},async(request:any,reply)=>{return await adminUsageSummary();});
  app.get("/web/admin/health",{preHandler:internalAdmin},async(request:any,reply)=>{const started=Date.now();const database=(await import("./db.js")).db;let databaseStatus="unavailable",databaseMs:number|null=null;try{if(database){const t=Date.now();await database.query("SELECT 1");databaseMs=Date.now()-t;databaseStatus="online"}}catch{databaseStatus="error"}return{api:"online",apiUptimeSeconds:Math.round(process.uptime()),database:databaseStatus,databaseMs,providers:providerStatus(),checkedAt:new Date().toISOString(),responseMs:Date.now()-started};});
  app.patch("/web/admin/settings",{preHandler:internalAdmin},async(request:any,reply)=>{const admin=request.webClient;const b=z.object({defaultCurrency:z.enum(["GBP","USD","EUR","AUD","CAD"])}).safeParse(request.body??{});if(!b.success)return reply.code(400).send({error:"invalid_request"});const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("UPDATE platform_settings SET default_currency=$1,updated_at=now() WHERE id=1 RETURNING default_currency",[b.data.defaultCurrency]);return{settings:{defaultCurrency:r.rows[0].default_currency,supportedCurrencies:["GBP","USD","EUR","AUD","CAD"]}};});
  app.patch("/web/admin/plans/:plan",{preHandler:internalAdmin},async(request:any,reply)=>{const admin=request.webClient;const p=z.object({plan:z.enum(["developer","commercial"])}).safeParse(request.params),b=z.object({monthlyQuota:z.number().int().min(0).max(100000000),rateLimitPerMinute:z.number().int().min(1).max(10000),prices:z.object({GBP:z.number().min(0),USD:z.number().min(0),EUR:z.number().min(0),AUD:z.number().min(0),CAD:z.number().min(0)}),active:z.boolean().default(true)}).safeParse(request.body??{});if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const database=(await import("./db.js")).db;if(!database)return reply.code(503).send({error:"database_unavailable"});const r=await database.query("UPDATE billing_plans SET monthly_quota=$2,rate_limit_per_minute=$3,prices=$4::jsonb,active=$5,updated_at=now() WHERE plan=$1 RETURNING plan,monthly_quota,rate_limit_per_minute,prices,active",[p.data.plan,b.data.monthlyQuota,b.data.rateLimitPerMinute,JSON.stringify(b.data.prices),b.data.active]);return{plan:r.rows[0]};});
  app.get("/web/plans",{preHandler:webClient},async(request:any)=>{const database=(await import("./db.js")).db;if(!database)return{plans:[],defaultCurrency:"GBP"};const [plans,settings]=await Promise.all([database.query("SELECT plan,monthly_quota,rate_limit_per_minute,prices,active FROM billing_plans WHERE active=true ORDER BY plan"),database.query("SELECT default_currency FROM platform_settings WHERE id=1")]);return{plans:plans.rows,defaultCurrency:request.webClient.preferred_currency??settings.rows[0]?.default_currency??"GBP",supportedCurrencies:["GBP","USD","EUR","AUD","CAD"]};});
  app.patch("/web/admin/clients/:id",{preHandler:internalAdmin},async(request:any,reply)=>{const admin=request.webClient;const p=z.object({id:z.string().uuid()}).safeParse(request.params),b=z.object({plan:z.enum(["developer","commercial"]).optional(),monthlyQuota:z.number().int().min(0).max(100000000).optional(),rateLimitPerMinute:z.number().int().min(1).max(10000).optional(),active:z.boolean().optional()}).safeParse(request.body??{});if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const client=await updateClientAdmin(p.data.id,b.data);return client?{client}:reply.code(404).send({error:"not_found"});});
  // Internal first-party marketplace access. Not exposed to third-party API customers.
  async function internalAliExpress(request:any, reply:any) {
    const token = process.env.ALIEXPRESS_INTERNAL_TOKEN;
    const header = request.headers.authorization;
    if (!token || !header || header !== "Bearer " + token) return reply.code(401).send({error:"unauthorized"});
    if (!officialConfigured()) return reply.code(503).send({error:"aliexpress_not_configured"});
  }
  app.get("/internal/aliexpress/search", {preHandler:internalAliExpress}, async (request:any,reply) => {
    const parsed=z.object({q:z.string().trim().min(1).max(120),page:z.coerce.number().int().min(1).max(100).default(1),currency:z.enum(["USD","GBP","EUR","CAD","AUD"]).default("USD"),country:z.string().regex(/^[A-Z]{2}$/).default("GB")}).safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:"invalid_request"});
    return officialSearch({query:parsed.data.q,page:parsed.data.page,currency:parsed.data.currency,country:parsed.data.country});
  });
  app.get("/internal/aliexpress/products/:id", {preHandler:internalAliExpress}, async (request:any,reply) => {
    const parsed=z.object({id:z.string().regex(/^\d{10,20}$/)}).safeParse(request.params);
    if(!parsed.success)return reply.code(400).send({error:"invalid_product_id"});
    const product=await officialProduct(parsed.data.id);
    return product ?? reply.code(404).send({error:"product_not_found"});
  });

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

    v1.get("/woocommerce/import-preview",{preHandler:requireScope("products:read")},async(request:any,reply)=>{const parsed=z.object({url:z.string().trim().min(4).max(1000),page:z.coerce.number().int().min(1).max(20).default(1)}).safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});try{const u=new URL(/^https?:\/\//i.test(parsed.data.url)?parsed.data.url:"https://"+parsed.data.url);if(u.protocol!=="https:"||u.username||u.password||u.port||!u.hostname.includes("."))throw Error("Enter a public HTTPS store URL.");const dns=await import("node:dns/promises");const addresses=await dns.lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>{const a=x.address.toLowerCase();if(a.includes(":"))return a==="::1"||a==="::"||a.startsWith("fc")||a.startsWith("fd")||a.startsWith("fe8")||a.startsWith("fe9")||a.startsWith("fea")||a.startsWith("feb")||a.startsWith("::ffff:");const p=a.split(".").map(Number);return p.length!==4||p[0]===10||p[0]===127||p[0]===0||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===100&&p[1]>=64&&p[1]<=127;}))throw Error("Private store addresses are not permitted.");const slug=u.pathname.match(/\/product\/([^/]+)/)?.[1],ep=new URL("https://"+u.hostname+"/wp-json/wc/store/v1/products");if(slug)ep.searchParams.set("slug",slug);else{ep.searchParams.set("per_page","50");ep.searchParams.set("page",String(parsed.data.page));}const r=await fetch(ep,{redirect:"error",headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error("WooCommerce Store API returned "+r.status);if(Number(r.headers.get("content-length")||0)>2000000)throw Error("Response too large");const body=await r.text();if(body.length>2000000)throw Error("Response too large");const rows=JSON.parse(body);if(!Array.isArray(rows))throw Error("Store API did not return a product list");const items=rows.slice(0,50).map((p:any)=>({provider:"woocommerce",externalId:String(p.id),sourceUrl:String(p.permalink||""),title:String(p.name||"Product"),description:String(p.description||p.short_description||"").replace(/<[^>]*>/g," ").trim(),category:String(p.categories?.[0]?.name||""),price:{amount:Number(p.prices?.price||0)/Math.pow(10,Number(p.prices?.currency_minor_unit??2)),currency:String(p.prices?.currency_code||"GBP")},images:(p.images||[]).map((x:any)=>({url:String(x.src||"")})),availability:p.is_in_stock===false?"out_of_stock":"in_stock",stockQuantity:typeof p.stock_quantity==="number"?p.stock_quantity:null}));recordUsage({clientId:request.apiClient!.id,route:"/v1/woocommerce/import-preview",timestamp:new Date().toISOString()});return{store:u.hostname,kind:slug?"product":"store",items,page:parsed.data.page};}catch(e:any){return reply.code(422).send({error:"woocommerce_url_unavailable",message:e.message||"Unable to load WooCommerce catalogue."})}});
    v1.get("/shopify/import-preview",{preHandler:requireScope("products:read")},async(request:any,reply)=>{const parsed=z.object({url:z.string().trim().min(4).max(1000)}).safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"invalid_request",message:"A Shopify store, collection or product URL is required."});try{const provider:any=getProvider("shopify");const result=await provider.browseUrl(parsed.data.url);recordUsage({clientId:request.apiClient!.id,route:"/v1/shopify/import-preview",provider:"shopify",timestamp:new Date().toISOString()});return result;}catch(e:any){return reply.code(400).send({error:"shopify_url_unavailable",message:e?.message||"The Shopify URL could not be loaded."});}});

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
