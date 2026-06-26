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
] as const;

loadEnv({ path: path.join(rootDir, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

async function verifyExcelWorkspaceItemColumns() {
  const rows = await client<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'excel_workspace_items'
  `;

  const present = new Set(rows.map((row) => row.column_name));
  const missing = REQUIRED_EXCEL_WORKSPACE_ITEM_COLUMNS.filter(
    (column) => !present.has(column),
  );

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      "Database schema is behind the application code.",
      `Missing columns on excel_workspace_items: ${missing.join(", ")}`,
      "Ensure drizzle/meta/_journal.json lists every SQL file in drizzle/, then run:",
      "  bun run db:migrate",
    ].join("\n"),
  );
}

try {
  console.log("Applying database migrations...");
  await migrate(db, { migrationsFolder: path.join(rootDir, "drizzle") });
  console.log("Verifying required schema columns...");
  await verifyExcelWorkspaceItemColumns();
  console.log("Migrations applied successfully.");
} catch (error) {
  console.error("Migration failed:");
  console.error(error);
  process.exit(1);
} finally {
  await client.end();
}
