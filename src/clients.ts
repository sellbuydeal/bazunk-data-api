import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";

export interface ApiClient {
 id:string; name:string; scopes:string[]; plan:"internal"|"developer"|"commercial";
 monthlyQuota?:number; rateLimitPerMinute?:number;
}
const hex=(v:string)=>createHash("sha256").update(v).digest("hex");
const digest=(v:string)=>createHash("sha256").update(v).digest();
function equalKey(a:string,b:string){const da=digest(a),dbb=digest(b);return da.length===dbb.length&&timingSafeEqual(da,dbb);}

export async function resolveClient(key:string):Promise<ApiClient|null>{
 if(db){
   const result=await db.query(`SELECT c.id,c.name,c.plan,c.monthly_quota,c.rate_limit_per_minute,k.scopes
    FROM api_keys k JOIN api_clients c ON c.id=k.client_id
    WHERE k.key_hash=$1 AND k.active=true AND c.active=true AND k.revoked_at IS NULL LIMIT 1`,[hex(key)]);
   if(result.rowCount){
     await db.query("UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1",[hex(key)]);
     const r=result.rows[0];
     return {id:r.id,name:r.name,plan:r.plan,scopes:r.scopes,monthlyQuota:r.monthly_quota,rateLimitPerMinute:r.rate_limit_per_minute};
   }
 }
 const index=[...config.apiKeys].findIndex(expected=>equalKey(key,expected));
 if(index<0)return null;
 return {id:index===0?"bazunk-marketplace":`bootstrap-${index+1}`,name:index===0?"Bazunk Marketplace":`Bootstrap Client ${index+1}`,scopes:["products:read","providers:read","usage:read"],plan:"internal"};
}
export function generateApiKey(prefix="bzk_live"){return `${prefix}_${randomBytes(24).toString("base64url")}`;}
