import pg from "pg";
import { config } from "./config.js";
const { Pool } = pg;

export const db = config.DATABASE_URL ? new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: 10
}) : null;

export async function databaseHealth() {
  if (!db) return { configured: false, ok: false };
  try {
    await db.query("SELECT 1");
    return { configured: true, ok: true };
  } catch {
    return { configured: true, ok: false };
  }
}
