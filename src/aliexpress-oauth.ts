import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";

export const aliexpressRedirectUri = () => process.env.ALIEXPRESS_REDIRECT_URI || "https://www.bazunk.com/api/integrations/aliexpress/callback";

export async function beginAliExpressAuthorization(): Promise<string> {
  if (!db || !process.env.ALIEXPRESS_APP_KEY) throw new Error("AliExpress authorization is not configured");
  const state = randomBytes(32).toString("hex");
  await db.query("INSERT INTO aliexpress_oauth_states (state_hash, expires_at) VALUES ($1, now() + interval '10 minutes')", [createHash("sha256").update(state).digest("hex")]);
  const url = new URL("https://api-sg.aliexpress.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.ALIEXPRESS_APP_KEY);
  url.searchParams.set("redirect_uri", aliexpressRedirectUri());
  url.searchParams.set("state", state);
  return url.toString();
}

export async function validateAliExpressState(state: string): Promise<void> {
  if (!db || !/^[a-f0-9]{64}$/.test(state)) throw new Error("Invalid OAuth state");
  const result = await db.query("DELETE FROM aliexpress_oauth_states WHERE state_hash=$1 AND expires_at > now() RETURNING state_hash", [createHash("sha256").update(state).digest("hex")]);
  if (!result.rowCount) throw new Error("OAuth state is expired or already used");
}

import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";

function encryptionKey(): Buffer {
  const secret = process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error("ALIEXPRESS_TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  return Buffer.from(secret, "hex");
}
function seal(value: string): string {
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64");
}
function unseal(value:string):string {
  const data=Buffer.from(value,"base64"),decipher=createDecipheriv("aes-256-gcm",encryptionKey(),data.subarray(0,12));
  decipher.setAuthTag(data.subarray(12,28));
  return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8");
}
async function tokenCall(path:string,parameters:Record<string,string>):Promise<Record<string,any>> {
  const appKey=process.env.ALIEXPRESS_APP_KEY,secret=process.env.ALIEXPRESS_APP_SECRET;
  if(!appKey||!secret)throw new Error("AliExpress credentials missing");
  const params:Record<string,string>={app_key:appKey,sign_method:"sha256",timestamp:String(Date.now()),...parameters};
  const signatureInput=path+Object.keys(params).sort().map(k=>k+params[k]).join("");
  params.sign=createHmac("sha256",secret).update(signatureInput).digest("hex").toUpperCase();
  const response=await fetch("https://api-sg.aliexpress.com/rest"+path,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error("AliExpress token HTTP "+response.status);
  const raw:any=await response.json();
  const result:any=typeof raw.gopResponseBody==="string"?JSON.parse(raw.gopResponseBody):raw;
  if(typeof result.access_token!=="string"||!result.access_token)throw new Error("AliExpress did not return an access token: "+String(result.message??result.msg??result.code??raw.gopErrorCode??"unknown").slice(0,100));
  return result;
}
async function saveToken(result:Record<string,any>):Promise<void>{
  if(!db)throw new Error("Database unavailable");
  const seconds=(v:unknown,fallback:number)=>{const n=Number(v);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;};
  await db.query(`INSERT INTO aliexpress_oauth_tokens(id,access_token,refresh_token,expires_at,refresh_expires_at)
    VALUES(1,$1,$2,now()+($3::int*interval '1 second'),now()+($4::int*interval '1 second'))
    ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,
    expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at`,
    [seal(result.access_token),seal(result.refresh_token),seconds(result.expires_in,2592000),seconds(result.refresh_expires_in,5184000)]);
}
export async function completeAliExpressAuthorization(code:string,state:string):Promise<void>{
  if(!/^[a-zA-Z0-9_-]{8,300}$/.test(code))throw new Error("Invalid AliExpress authorization code");
  await validateAliExpressState(state);
  await saveToken(await tokenCall("/auth/token/create",{code}));
}
export async function aliexpressAccessToken():Promise<string>{
  if(!db)throw new Error("Database unavailable");
  const r=await db.query("SELECT * FROM aliexpress_oauth_tokens WHERE id=1");
  if(!r.rowCount)throw new Error("AliExpress authorization required");
  const token=r.rows[0];
  if(new Date(token.expires_at).getTime()>Date.now()+300000)return unseal(token.access_token);
  if(new Date(token.refresh_expires_at).getTime()<Date.now())throw new Error("AliExpress authorization expired");
  const refreshed=await tokenCall("/auth/token/refresh",{refresh_token:unseal(token.refresh_token)});
  await saveToken({...refreshed,refresh_token:refreshed.refresh_token||unseal(token.refresh_token)});
  return refreshed.access_token;
}
export async function aliexpressAuthorizationStatus():Promise<boolean>{
  if(!db)return false;
  const r=await db.query("SELECT id FROM aliexpress_oauth_tokens WHERE id=1");
  return !!r.rowCount;
}
