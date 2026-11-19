import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { requireTestDatabase } from "../tests/fixtures/remediation/test-target";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const databaseUrl = requireTestDatabase();
const env = {
  ...process.env,
  DATABASE_URL: "",
  BIDTOOL_DEPLOYMENT_SURFACE: "",
  NEXT_TELEMETRY_DISABLED: "1",
};

for (const script of ["check", "test", "test:integration", "build"]) {
  const result = spawnSync(process.execPath, ["run", script], {
    cwd,
    env:
      script === "build"
        ? {
            ...env,
            DATABASE_URL: databaseUrl,
            BIDTOOL_DEPLOYMENT_SURFACE: "web",
          }
        : env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
