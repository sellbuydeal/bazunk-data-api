import { z } from "zod";
const schema=z.object({
 NODE_ENV:z.enum(["development","test","production"]).default("development"),
 PORT:z.coerce.number().int().positive().default(3000), HOST:z.string().default("0.0.0.0"),
 DATABASE_URL:z.string().optional(), CLERK_SECRET_KEY:z.string().optional(), INTERNAL_ADMIN_EMAIL:z.string().email().optional(), BAZUNK_API_KEYS:z.string().default(""), CORS_ORIGINS:z.string().default(""),
 DEFAULT_RATE_LIMIT:z.coerce.number().int().positive().default(120), DEFAULT_RATE_WINDOW:z.string().default("1 minute"), AMAZON_PROVIDER:z.enum(["disabled","http"]).default("disabled"), AMAZON_SOURCE_URL:z.string().url().optional(), AMAZON_SOURCE_TOKEN:z.string().optional()
});
const env=schema.parse(process.env);
export const config={...env,apiKeys:new Set(env.BAZUNK_API_KEYS.split(",").map(v=>v.trim()).filter(Boolean)),corsOrigins:env.CORS_ORIGINS.split(",").map(v=>v.trim()).filter(Boolean)};
