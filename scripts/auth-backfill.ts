import process from "node:process";

import postgres from "postgres";

/**
 * Auth rollout — one-time data backfill (Phase 7).
 *
 * Run order in the auth rollout sequence:
 *   1. Ship + apply migrations         (`bun run db:migrate` / db-migrate-runtime.mjs at boot)
 *   2. Run THIS backfill               (`bun run auth:backfill`)
 *   3. Flip AUTH_ENABLED="true"        (restart the app)
 *
 * This script is intentionally NOT wired into the Docker entrypoint: it is a
 * one-time data migration that ops runs explicitly, after schema migrations and
 * before enabling auth. It is idempotent — a second run updates 0 rows.
 *
 * What it does:
 *   1. Ensures a single "host" tenant exists (slug "host"); captures its id.
 *   2. Attributes all pre-existing owned-data rows (tenantId IS NULL) to the
 *      host tenant, across the 8 owned tables. Internal users aren't tenant
 *      filtered, but this keeps the data model coherent and lets the host org
 *      later be converted or have real customers assigned.
 *   3. Reports the actor-audit columns (excel_workspace_events,
 *      excel_research_change_log). Pre-auth rows carry actor="system"; we do
 *      NOT fabricate user ids, so this step is informational only.
 *
 * Uses a standalone postgres-js client (same pattern as db-migrate-runtime.mjs)
 * so it runs via `bun run ./scripts/auth-backfill.ts` reading DATABASE_URL,
 * independent of the app's env-validated db.
 */

const HOST_TENANT_SLUG = "host";
const HOST_TENANT_NAME = "Host Organization";

// The 8 owned tables carrying a nullable tenant_id (Phase 1 schema).
const OWNED_TABLES = [
  "excel_research_jobs",
  "material_enrichment_jobs",
  "shop_scrape_jobs",
  "shop_import_jobs",
  "watchlist_items",
  "saved_filters",
  "workflows",
  "notifications",
] as const;

// Tables with an `actor` audit column (default "system").
const ACTOR_TABLES = [
  "excel_workspace_events",
  "excel_research_change_log",
] as const;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Refusing to run the auth backfill without a database connection.",
    );
  }
  return databaseUrl;
}

/**
 * Ensure the single host tenant exists and return its id. Idempotent via the
 * unique slug index: insert is a no-op on a second run, then we read the id.
 */
async function ensureHostTenant(sql: postgres.Sql): Promise<string> {
  await sql`
    INSERT INTO "tenant" ("name", "slug")
    VALUES (${HOST_TENANT_NAME}, ${HOST_TENANT_SLUG})
    ON CONFLICT ("slug") DO NOTHING
  `;

  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "tenant" WHERE "slug" = ${HOST_TENANT_SLUG} LIMIT 1
  `;

  const hostTenant = rows[0];
  if (!hostTenant) {
    throw new Error("Failed to ensure host tenant: no row returned after upsert.");
  }
  return hostTenant.id;
}

async function backfillOwnedTables(
  sql: postgres.Sql,
  hostTenantId: string,
): Promise<Record<string, number>> {
  const updatedByTable: Record<string, number> = {};

  for (const table of OWNED_TABLES) {
    // sql(table) renders a safe quoted identifier; the WHERE clause keeps the
    // update idempotent (only rows still missing a tenant are touched).
    const result = await sql`
      UPDATE ${sql(table)}
      SET "tenant_id" = ${hostTenantId}
      WHERE "tenant_id" IS NULL
    `;
    updatedByTable[table] = result.count;
  }

  return updatedByTable;
}

async function reportActorColumns(
  sql: postgres.Sql,
): Promise<Record<string, number>> {
  const systemByTable: Record<string, number> = {};

  for (const table of ACTOR_TABLES) {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ${sql(table)} WHERE "actor" = 'system'
    `;
    systemByTable[table] = Number(rows[0]?.count ?? "0");
  }

  return systemByTable;
}

async function main() {
  const sql = postgres(requireDatabaseUrl(), {
    connect_timeout: 5,
    max: 1,
  });

  try {
    console.log("[auth-backfill] Starting auth data backfill.");

    const hostTenantId = await ensureHostTenant(sql);
    console.log(
      `[auth-backfill] Host tenant ready: slug="${HOST_TENANT_SLUG}" id=${hostTenantId}`,
    );

    const updatedByTable = await backfillOwnedTables(sql, hostTenantId);
    console.log("[auth-backfill] Owned-data rows attributed to host tenant:");
    let totalUpdated = 0;
    for (const table of OWNED_TABLES) {
      const count = updatedByTable[table] ?? 0;
      totalUpdated += count;
      console.log(`  - ${table}: ${count} row(s) updated`);
    }
    console.log(`[auth-backfill] Total owned rows updated: ${totalUpdated}`);

    const systemByTable = await reportActorColumns(sql);
    console.log(
      "[auth-backfill] Actor audit columns (informational — not modified):",
    );
    for (const table of ACTOR_TABLES) {
      console.log(
        `  - ${table}: ${systemByTable[table] ?? 0} row(s) with actor="system" (left as-is; no user id fabricated)`,
      );
    }

    console.log("[auth-backfill] Done. Safe to re-run (idempotent).");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[auth-backfill] Backfill failed: ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
