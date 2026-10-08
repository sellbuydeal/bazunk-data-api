import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js"; import { db } from "./db.js";
export interface ApiClient{id:string;name:string;scopes:string[];plan:"internal"|"developer"|"commercial";monthlyQuota?:number;rateLimitPerMinute?:number;}
const hex=(v:string)=>createHash("sha256").update(v).digest("hex"); const digest=(v:string)=>createHash("sha256").update(v).digest();
function equalKey(a:string,b:string){const da=digest(a),dbb=digest(b);return da.length===dbb.length&&timingSafeEqual(da,dbb);}
export async function resolveClient(key:string):Promise<ApiClient|null>{
 if(db){const result=await db.query(`SELECT c.id,c.name,c.plan,c.monthly_quota,c.rate_limit_per_minute,c.active AS client_active,k.scopes,k.active AS key_active,k.revoked_at FROM api_keys k JOIN api_clients c ON c.id=k.client_id WHERE k.key_hash=$1 LIMIT 1`,[hex(key)]);
 if(result.rowCount){const r=result.rows[0];if(!r.key_active||!r.client_active||r.revoked_at)return null;await db.query("UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1",[hex(key)]);return{id:r.id,name:r.name,plan:r.plan,scopes:r.scopes,monthlyQuota:r.monthly_quota,rateLimitPerMinute:r.rate_limit_per_minute};}}
 const index=[...config.apiKeys].findIndex(expected=>equalKey(key,expected)); if(index<0)return null;
 return{id:index===0?"bazunk-marketplace":`bootstrap-${index+1}`,name:index===0?"Bazunk Marketplace":`Bootstrap Client ${index+1}`,scopes:["products:read","providers:read","usage:read","keys:manage"],plan:"internal"};
}
export function generateApiKey(prefix="bzk_live"){return `${prefix}_${randomBytes(24).toString("base64url")}`;}
export async function listKeys(clientId:string){if(!db)return[];const r=await db.query("SELECT id,key_prefix,label,scopes,active,last_used_at,created_at,revoked_at,(scopes @> ARRAY['clients:manage']::text[] OR scopes @> ARRAY['keys:manage']::text[]) AS protected FROM api_keys WHERE client_id=$1 ORDER BY created_at DESC",[clientId]);return r.rows;}
export async function issueKey(clientId:string,label:string,scopes:string[]){if(!db)throw new Error("database_unavailable");const key=generateApiKey();const r=await db.query("INSERT INTO api_keys(client_id,key_prefix,key_hash,label,scopes) VALUES($1,$2,$3,$4,$5) RETURNING id",[clientId,key.slice(0,16),hex(key),label,scopes]);return{id:r.rows[0].id,key,keyPrefix:key.slice(0,16),label,scopes};}
export async function revokeKey(clientId:string,keyId:string){if(!db)throw new Error("database_unavailable");const r=await db.query("UPDATE api_keys SET active=false,revoked_at=now() WHERE id=$1 AND client_id=$2 AND revoked_at IS NULL AND NOT (scopes @> ARRAY['clients:manage']::text[] OR scopes @> ARRAY['keys:manage']::text[]) RETURNING id",[keyId,clientId]);return Boolean(r.rowCount);}

export async function getClientById(id:string){if(!db)return null;const r=await db.query("SELECT id,name,plan,monthly_quota,rate_limit_per_minute,preferred_currency,active,created_at FROM api_clients WHERE id=$1",[id]);return r.rows[0]??null;}
export async function updateClientAdmin(id:string,input:{plan?:"developer"|"commercial";monthlyQuota?:number;rateLimitPerMinute?:number;active?:boolean}){if(!db)throw new Error("database_unavailable");const current=await getClientById(id);if(!current||current.plan==="internal")return null;const r=await db.query("UPDATE api_clients SET plan=COALESCE($2,plan),monthly_quota=COALESCE($3,monthly_quota),rate_limit_per_minute=COALESCE($4,rate_limit_per_minute),active=COALESCE($5,active) WHERE id=$1 AND plan<>'internal' RETURNING id,name,plan,monthly_quota,rate_limit_per_minute,active,created_at",[id,input.plan??null,input.monthlyQuota??null,input.rateLimitPerMinute??null,input.active??null]);return r.rows[0]??null;}
export async function listClients(){if(!db)return[];const r=await db.query("SELECT c.id,c.name,c.plan,c.monthly_quota,c.rate_limit_per_minute,c.active,c.created_at,count(k.id)::int AS key_count FROM api_clients c LEFT JOIN api_keys k ON k.client_id=c.id GROUP BY c.id ORDER BY c.created_at DESC");return r.rows;}
export async function createClient(input:{name:string;plan:"internal"|"developer"|"commercial";monthlyQuota:number;rateLimitPerMinute:number}){if(!db)throw new Error("database_unavailable");const r=await db.query("INSERT INTO api_clients(name,plan,monthly_quota,rate_limit_per_minute) VALUES($1,$2,$3,$4) RETURNING id,name,plan,monthly_quota,rate_limit_per_minute,active,created_at",[input.name,input.plan,input.monthlyQuota,input.rateLimitPerMinute]);return r.rows[0];}
export async function setClientActive(id:string,active:boolean){if(!db)throw new Error("database_unavailable");const r=await db.query("UPDATE api_clients SET active=$2 WHERE id=$1 RETURNING id,active",[id,active]);return r.rows[0]??null;}

export async function getOrCreateClerkClient(clerkUserId:string,name:string,emailVerified=false){
 if(!db)throw new Error("database_unavailable");
 let r=await db.query("SELECT id,name,plan,monthly_quota,rate_limit_per_minute,preferred_currency,active FROM api_clients WHERE clerk_user_id=$1",[clerkUserId]);
 const isConfiguredAdmin=emailVerified&&Boolean(config.INTERNAL_ADMIN_EMAIL)&&name.toLowerCase()===config.INTERNAL_ADMIN_EMAIL!.toLowerCase();
 if(r.rowCount){
  if(!isConfiguredAdmin||r.rows[0].plan==="internal")return r.rows[0];
  // Repair an earlier normal signup for the configured admin: release that developer row,
  // then attach the verified Clerk identity to the reserved internal account.
  const promoted=await db.query("WITH old AS (UPDATE api_clients SET clerk_user_id=NULL WHERE id=$2 AND clerk_user_id=$1 RETURNING id) UPDATE api_clients SET clerk_user_id=$1,name=$3 WHERE id=(SELECT id FROM api_clients WHERE plan='internal' AND (clerk_user_id IS NULL OR clerk_user_id=$1) ORDER BY created_at LIMIT 1) RETURNING id,name,plan,monthly_quota,rate_limit_per_minute,preferred_currency,active",[clerkUserId,r.rows[0].id,name]);
  if(promoted.rowCount)return promoted.rows[0];
  // No reserved internal row exists: promote this verified, explicitly configured account in place.
  const inPlace=await db.query("UPDATE api_clients SET clerk_user_id=$1,plan='internal',monthly_quota=1000000,rate_limit_per_minute=240 WHERE id=$2 RETURNING id,name,plan,monthly_quota,rate_limit_per_minute,preferred_currency,active",[clerkUserId,r.rows[0].id]);
  if(inPlace.rowCount)return inPlace.rows[0];
 }
 // One-time bootstrap: only the configured verified Bazunk admin email may claim an unlinked internal client.
 if(isConfiguredAdmin){
  r=await db.query("UPDATE api_clients SET clerk_user_id=$1,name=$2 WHERE id=(SELECT id FROM api_clients WHERE plan='internal' AND clerk_user_id IS NULL ORDER BY created_at LIMIT 1) AND clerk_user_id IS NULL RETURNING id,name,plan,monthly_quota,rate_limit_per_minute,preferred_currency,active",[clerkUserId,name]);
  if(r.rowCount)return r.rows[0];
 }
 r=await db.query("INSERT INTO api_clients(name,clerk_user_id,plan,monthly_quota,rate_limit_per_minute) VALUES($1,$2,'developer',1000,60) RETURNING id,name,plan,monthly_quota,rate_limit_per_minute,active",[name,clerkUserId]);return r.rows[0];
}
