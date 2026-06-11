import { config as loadEnv } from "dotenv";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

try {
  const tables = await client<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  if (tables.length === 0) {
    console.log("No public tables found. Nothing to wipe.");
    process.exit(0);
  }

  const tableList = tables
    .map(({ tablename }) => `"public"."${tablename.replace(/"/g, '""')}"`)
    .join(", ");

  console.log(`Wiping ${tables.length} tables...`);
  await client.unsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );
  console.log("All data deleted. Schema and migrations are unchanged.");
} catch (error) {
  console.error("Database wipe failed:");
  console.error(error);
  process.exit(1);
} finally {
  await client.end();
}
