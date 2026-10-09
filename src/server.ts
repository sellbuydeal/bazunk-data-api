import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrateDatabase, bootstrapInternalClient, db } from "./db.js";
import { getProvider } from "./providers/registry.js";

try {
  await migrateDatabase();
  await bootstrapInternalClient();
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
  // Each running API instance refreshes a small batch of due products.
  // A Postgres advisory lock prevents duplicate concurrent refresh runs.
  if (db) {
    const refresh = async () => {
      const client = await db.connect();
      try {
        const lock = await client.query("SELECT pg_try_advisory_lock(87423019) AS acquired");
        if (!lock.rows[0]?.acquired) return;
        try {
          const due = await client.query("SELECT external_id FROM product_catalogue WHERE provider='aliexpress' AND next_sync_at<=now() ORDER BY next_sync_at LIMIT 10");
          for (const row of due.rows) {
            try {
              const item = await getProvider("aliexpress").getProduct(row.external_id);
              if (!item) throw new Error("Product unavailable");
              await client.query("UPDATE product_catalogue SET product=$2::jsonb,last_fetched_at=now(),next_sync_at=now()+interval '6 hours',sync_error=NULL WHERE provider='aliexpress' AND external_id=$1", [row.external_id,JSON.stringify(item)]);
            } catch (error) {
              await client.query("UPDATE product_catalogue SET sync_error=$2,next_sync_at=now()+interval '1 hour' WHERE provider='aliexpress' AND external_id=$1", [row.external_id,String(error).slice(0,300)]);
            }
          }
        } finally { await client.query("SELECT pg_advisory_unlock(87423019)"); }
      } catch (error) { app.log.warn({err:error}, "Catalogue sync failed"); }
      finally { client.release(); }
    };
    const timer = setInterval(() => { void refresh(); }, 15 * 60 * 1000);
    timer.unref();
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
