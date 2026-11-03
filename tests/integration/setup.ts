import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { requireTestDatabase } from "../fixtures/remediation/test-target";

export async function migrateTestDatabase(databaseUrl = requireTestDatabase()) {
  // Validate even explicit callers before spawning the migration command.
  requireTestDatabase({ BIDTOOL_TEST_DATABASE_URL: databaseUrl });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("bun", ["run", "db:migrate"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATABASE_URL: databaseUrl,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Test database migration failed (${code}).`)),
    );
  });
}

export default async function setup() {
  await migrateTestDatabase();
}
