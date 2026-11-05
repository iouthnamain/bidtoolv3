import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { createStorageDocker } from "./storage-fixture";

test.each([
  ["dump", "pg_restore"],
  ["sql", "psql"],
])(
  "a failing fake %s restore never starts the app",
  async (extension, command) => {
    const fake = await createStorageDocker(command);
    try {
      const backup = path.join(fake.dir, `backup.${extension}`);
      const envFile = path.join(fake.dir, "fixture.env");
      await writeFile(backup, "fixture-only");
      await writeFile(
        envFile,
        `POSTGRES_USER=bidtool_test\nPOSTGRES_DB=bidtool_test_restore\nBIDTOOL_BACKUP_DIR='${path.join(fake.dir, "backups")}'\n`,
      );
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          "sh",
          [
            "scripts/onprem-restore.sh",
            backup,
            "--database-only",
            "--schema-compatible",
          ],
          {
            env: {
              NODE_ENV: "test",
              FAKE_APP_PRESENT: "false",
              ...fake.env,
              BIDTOOL_ONPREM_ENV_FILE: envFile,
              BIDTOOL_ONPREM_PROJECT: `fixture-${path.basename(fake.dir)}`,
            },
            stdio: "pipe",
          },
        );
        child.stdout.resume();
        child.stderr.resume();
        child.once("error", reject);
        child.once("exit", resolve);
      });
      expect(code).toBe(23);
      const commands = await fake.commands();
      expect(
        commands.some((args) => args.includes("stop") && args.includes("app")),
      ).toBe(true);
      expect(commands.some((args) => args.includes(command))).toBe(true);
      const restore = commands.find((args) => args.includes(command));
      expect(restore).toContain(
        extension === "sql" ? "ON_ERROR_STOP=1" : "--exit-on-error",
      );
      expect(
        commands.some((args) => args.includes("up") || args.includes("start")),
      ).toBe(false);
    } finally {
      await fake.cleanup();
    }
  },
);
