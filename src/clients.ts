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
export async function listKeys(clientId:string){if(!db)return[];const r=await db.query("SELECT id,key_prefix,label,scopes,active,last_used_at,created_at,revoked_at FROM api_keys WHERE client_id=$1 ORDER BY created_at DESC",[clientId]);return r.rows;}
export async function issueKey(clientId:string,label:string,scopes:string[]){if(!db)throw new Error("database_unavailable");const key=generateApiKey();await db.query("INSERT INTO api_keys(client_id,key_prefix,key_hash,label,scopes) VALUES($1,$2,$3,$4,$5)",[clientId,key.slice(0,16),hex(key),label,scopes]);return{key,keyPrefix:key.slice(0,16),label,scopes};}
export async function revokeKey(clientId:string,keyId:string){if(!db)throw new Error("database_unavailable");const r=await db.query("UPDATE api_keys SET active=false,revoked_at=now() WHERE id=$1 AND client_id=$2 AND revoked_at IS NULL RETURNING id",[keyId,clientId]);return Boolean(r.rowCount);}
