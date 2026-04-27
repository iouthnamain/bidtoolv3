import { config as loadEnv } from "dotenv";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

loadEnv({ path: path.join(rootDir, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

try {
  console.log("Applying database migrations...");
  await migrate(db, { migrationsFolder: path.join(rootDir, "drizzle") });
  console.log("Migrations applied successfully.");
} catch (error) {
  console.error("Migration failed:");
  console.error(error);
  process.exit(1);
} finally {
  await client.end();
}
