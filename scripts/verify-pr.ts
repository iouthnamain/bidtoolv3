import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseReleasePins } from "../src/lib/release-manifest";
import { requireTestDatabase } from "../tests/fixtures/remediation/test-target";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const databaseUrl = requireTestDatabase();
const env = {
  ...process.env,
  DATABASE_URL: "",
  BIDTOOL_DEPLOYMENT_SURFACE: "",
  NEXT_TELEMETRY_DISABLED: "1",
};

function runScript(script: string, args: string[] = []) {
  const result = spawnSync(process.execPath, ["run", script, ...args], {
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

for (const script of ["check", "test", "test:integration"]) runScript(script);
runScript("build", ["--dist", ".next/verify"]);

parseReleasePins(
  JSON.parse(readFileSync(path.join(cwd, "releases/pins.json"), "utf8")),
);
const fixture = mkdtempSync(path.join(tmpdir(), "bidtool-release-check-"));
const input = path.join(fixture, "manifest-input.json");
writeFileSync(
  input,
  JSON.stringify({
    version: "0.0.0-local",
    commitSha: "0000000",
    changelog: "Local verification fixture",
    web: {
      buildId: "dpl_local",
      deploymentUrl: "https://example.com",
      buildMetadata: "0.0.0-local+web.0000000",
    },
    onprem: {
      image: "ghcr.io/example/bidtoolv3:0.0.0-local",
      digest: "sha256:deadbeef",
      buildMetadata: "0.0.0-local+onprem.0000000",
    },
    desktop: {
      linux: {
        url: "https://example.com/app.AppImage",
        version: "0.0.0-local+desktop.linux.0000000",
      },
    },
  }),
);
runScript("release:manifest", [
  "--input",
  input,
  "--output",
  path.join(fixture, "manifest.json"),
]);
runScript("release:status");
