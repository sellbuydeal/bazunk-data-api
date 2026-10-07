import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveClient, type ApiClient } from "./clients.js";
import { currentMonthRequests } from "./usage.js";

declare module "fastify" { interface FastifyRequest { apiClient:ApiClient|null; } }
const minuteBuckets=new Map<string,{start:number,count:number}>();
function checkClientRate(client:ApiClient){const limit=client.rateLimitPerMinute;if(!limit)return null;const now=Date.now(),windowMs=60000;let b=minuteBuckets.get(client.id);if(!b||now-b.start>=windowMs){b={start:now,count:0};minuteBuckets.set(client.id,b);}b.count++;return b.count>limit?Math.max(1,Math.ceil((windowMs-(now-b.start))/1000)):null;}
const minuteBuckets=new Map<string,{start:number,count:number}>();
function checkClientRate(client:ApiClient){
 const limit=client.rateLimitPerMinute; if(!limit)return null;
 const now=Date.now(),windowMs=60_000; let b=minuteBuckets.get(client.id);
 if(!b||now-b.start>=windowMs){b={start:now,count:0};minuteBuckets.set(client.id,b);}
 b.count++; return b.count>limit?Math.max(1,Math.ceil((windowMs-(now-b.start))/1000)):null;
}

export async function requireApiKey(request:FastifyRequest,reply:FastifyReply){
 const supplied=request.headers["x-api-key"]; const key=Array.isArray(supplied)?supplied[0]:supplied;
 const client=key?await resolveClient(key):null; request.apiClient=client;
 if(!client)return reply.code(401).send({error:"unauthorized",message:"A valid X-API-Key header is required."});
 const retryAfter=checkClientRate(client);if(retryAfter){reply.header("Retry-After",String(retryAfter));return reply.code(429).send({error:"rate_limit_exceeded",message:"Per-client rate limit exceeded.",limit:client.rateLimitPerMinute,retryAfter});}
 const retryAfter=checkClientRate(client);if(retryAfter){reply.header("Retry-After",String(retryAfter));return reply.code(429).send({error:"rate_limit_exceeded",message:"Per-client rate limit exceeded.",limit:client.rateLimitPerMinute,retryAfter});}
 if(client.monthlyQuota!==undefined){
  const used=await currentMonthRequests(client.id);
  if(used>=client.monthlyQuota)return reply.code(429).send({error:"monthly_quota_exceeded",message:"Monthly API quota exceeded.",quota:client.monthlyQuota,used});
 }
}
export function requireScope(scope:string){
 return async(request:FastifyRequest,reply:FastifyReply)=>{
  if(!request.apiClient?.scopes.includes(scope))return reply.code(403).send({error:"forbidden",message:`Required scope: ${scope}`});
 };
}
