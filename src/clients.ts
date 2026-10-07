import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export interface ApiClient {
  id: string;
  name: string;
  scopes: string[];
  plan: "internal" | "developer" | "commercial";
}

function digest(value: string) { return createHash("sha256").update(value).digest(); }
function equalKey(a: string, b: string) {
  const da = digest(a); const db = digest(b);
  return da.length === db.length && timingSafeEqual(da, db);
}

export function resolveClient(key: string): ApiClient | null {
  const index = [...config.apiKeys].findIndex(expected => equalKey(key, expected));
  if (index < 0) return null;
  return {
    id: index === 0 ? "bazunk-marketplace" : `bootstrap-${index + 1}`,
    name: index === 0 ? "Bazunk Marketplace" : `Bootstrap Client ${index + 1}`,
    scopes: ["products:read", "providers:read", "usage:read"],
    plan: "internal"
  };
}

export function generateApiKey(prefix = "bzk_live") {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}
