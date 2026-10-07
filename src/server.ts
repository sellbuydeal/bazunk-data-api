import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrateDatabase } from "./db.js";

try {
  await migrateDatabase();
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  console.error(error);
  process.exit(1);
}
