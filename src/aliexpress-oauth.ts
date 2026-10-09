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
