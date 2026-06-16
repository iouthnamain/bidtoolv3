import { config as loadEnv } from "dotenv";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const SYSTEM_TABLES = new Set(["__drizzle_migrations"]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

loadEnv({ path: path.join(rootDir, ".env") });

type CliOptions = {
  dryRun: boolean;
  keepSettings: boolean;
  yes: boolean;
};

function printUsage() {
  console.log(`BidTool database clear CLI

Deletes all row data from application tables. Tables, columns, indexes,
and migration history are left intact.

Usage:
  bun run db:clear [options]

Options:
  --dry-run              List tables that would be cleared, without deleting
  --keep-settings        Preserve rows in app_settings (API keys, preferences)
  --yes, -y              Skip confirmation prompt
  --help, -h             Show this help

Examples:
  bun run db:clear
  bun run db:clear --dry-run
  bun run db:clear --keep-settings --yes
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    keepSettings: false,
    yes: false,
  };

  for (const arg of argv) {
    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--keep-settings":
        options.keepSettings = true;
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}. Use --help for usage.`);
    }
  }

  return options;
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function quoteTable(name: string): string {
  return `"public"."${name.replace(/"/g, '""')}"`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

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

    const skipped = tables
      .map(({ tablename }) => tablename)
      .filter(
        (name) =>
          SYSTEM_TABLES.has(name) ||
          (options.keepSettings && name === "app_settings"),
      );

    const toClear = tables
      .map(({ tablename }) => tablename)
      .filter(
        (name) =>
          !SYSTEM_TABLES.has(name) &&
          !(options.keepSettings && name === "app_settings"),
      );

    if (toClear.length === 0) {
      console.log("No application tables found. Nothing to clear.");
      return;
    }

    const rowCounts = await client<
      { relname: string; n_live_tup: string | number }[]
    >`
      SELECT relname, n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
    `;
    const countByTable = new Map(
      rowCounts.map(({ relname, n_live_tup }) => [
        relname,
        Number(n_live_tup),
      ]),
    );

    console.log(
      options.dryRun
        ? `Would clear ${toClear.length} table(s):`
        : `Clearing data from ${toClear.length} table(s):`,
    );
    for (const name of toClear) {
      const rows = countByTable.get(name);
      const rowLabel =
        typeof rows === "number" ? ` (~${rows.toLocaleString()} rows)` : "";
      console.log(`  - ${name}${rowLabel}`);
    }

    if (skipped.length > 0) {
      console.log("\nSkipped (schema or settings preserved):");
      for (const name of skipped) {
        console.log(`  - ${name}`);
      }
    }

    if (options.dryRun) {
      console.log("\nDry run only. No data was deleted.");
      return;
    }

    if (!options.yes) {
      const approved = await confirm(
        "\nThis permanently deletes all data in the tables listed above.",
      );
      if (!approved) {
        console.log("Cancelled.");
        return;
      }
    }

    const tableList = toClear.map(quoteTable).join(", ");
    await client.unsafe(
      `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
    );
    console.log("\nAll application data deleted. Schema and migrations are unchanged.");
  } catch (error) {
    console.error("Database clear failed:");
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
