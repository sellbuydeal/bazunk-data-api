import { z } from "zod";
const schema=z.object({
 NODE_ENV:z.enum(["development","test","production"]).default("development"),
 PORT:z.coerce.number().int().positive().default(3000), HOST:z.string().default("0.0.0.0"),
 DATABASE_URL:z.string().optional(), BAZUNK_API_KEYS:z.string().default(""), CORS_ORIGINS:z.string().default(""),
 DEFAULT_RATE_LIMIT:z.coerce.number().int().positive().default(120), DEFAULT_RATE_WINDOW:z.string().default("1 minute")
});
const env=schema.parse(process.env);
export const config={...env,apiKeys:new Set(env.BAZUNK_API_KEYS.split(",").map(v=>v.trim()).filter(Boolean)),corsOrigins:env.CORS_ORIGINS.split(",").map(v=>v.trim()).filter(Boolean)};
