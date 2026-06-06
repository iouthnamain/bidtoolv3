import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const migrationsFolder = path.join(rootDir, "drizzle");
const attempts = Number(process.env.BIDTOOL_MIGRATION_ATTEMPTS ?? "30");
const delayMs = Number(process.env.BIDTOOL_MIGRATION_RETRY_MS ?? "2000");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }
  return databaseUrl;
}

async function runMigration() {
  const client = postgres(requireDatabaseUrl(), {
    connect_timeout: 5,
    max: 1,
  });
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end();
  }
}

let lastError = null;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    console.log(`[bidtool] Applying database migrations (${attempt}/${attempts})`);
    await runMigration();
    console.log("[bidtool] Database migrations are up to date.");
    process.exit(0);
  } catch (error) {
    lastError = error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bidtool] Migration attempt failed: ${message}`);

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
}

console.error("[bidtool] Database migration failed.");
if (lastError) {
  console.error(lastError);
}
process.exit(1);
