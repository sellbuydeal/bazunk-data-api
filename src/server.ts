import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrateDatabase, bootstrapInternalClient } from "./db.js";

try {
  await migrateDatabase();
  await bootstrapInternalClient();
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  console.error(error);
  process.exit(1);
}
