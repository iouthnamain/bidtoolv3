import { config as loadEnv } from "dotenv";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

/** Columns the app schema expects; used to catch journal/SQL drift after migrate. */
const REQUIRED_EXCEL_WORKSPACE_ITEM_COLUMNS = [
  "enrichment_status",
  "web_results_json",
  "ai_fields_json",
  "ai_evidence_json",
  "enrichment_updated_at",
  "review_decision_json",
  "source_fingerprint",
  "is_stale",
] as const;

const REQUIRED_MATERIAL_PROFILE_TABLES = [
  "material_profile_search_cache",
  "material_profile_promotion_ledger",
] as const;

loadEnv({ path: path.join(rootDir, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

async function verifyMaterialProfileSchema() {
  const [columnRows, tableRows] = await Promise.all([
    client<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'excel_workspace_items'
    `,
    client<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `,
  ]);

  const presentColumns = new Set(columnRows.map((row) => row.column_name));
  const missingColumns = REQUIRED_EXCEL_WORKSPACE_ITEM_COLUMNS.filter(
    (column) => !presentColumns.has(column),
  );
  const presentTables = new Set(tableRows.map((row) => row.table_name));
  const missingTables = REQUIRED_MATERIAL_PROFILE_TABLES.filter(
    (table) => !presentTables.has(table),
  );

  if (missingColumns.length === 0 && missingTables.length === 0) {
    return;
  }

  throw new Error(
    [
      "Database schema is behind the application code.",
      missingColumns.length > 0
        ? `Missing columns on excel_workspace_items: ${missingColumns.join(", ")}`
        : null,
      missingTables.length > 0
        ? `Missing material-profile tables: ${missingTables.join(", ")}`
        : null,
      "Ensure drizzle/meta/_journal.json lists every SQL file in drizzle/, then run:",
      "  bun run db:migrate",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  );
}

try {
  console.log("Applying database migrations...");
  await migrate(db, { migrationsFolder: path.join(rootDir, "drizzle") });
  console.log("Verifying required material-profile schema...");
  await verifyMaterialProfileSchema();
  console.log("Migrations applied successfully.");
} catch (error) {
  console.error("Migration failed:");
  console.error(error);
  process.exit(1);
} finally {
  await client.end();
}
