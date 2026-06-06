import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const nextBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);

function resolveDistDir() {
  const distArgIndex = process.argv.indexOf("--dist");
  const equalsArg = process.argv.find((arg) => arg.startsWith("--dist="));
  const rawDistDir =
    equalsArg?.slice("--dist=".length) ??
    (distArgIndex >= 0 ? process.argv[distArgIndex + 1] : undefined) ??
    process.env.BIDTOOL_NEXT_DIST_DIR ??
    ".next";
  const distDir = rawDistDir.trim();

  if (!distDir || distDir === "--dist") {
    throw new Error("Missing value for --dist.");
  }
  if (path.isAbsolute(distDir) || distDir.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid build output directory '${distDir}'.`);
  }

  return distDir;
}

async function main() {
  const distDir = resolveDistDir();

  await rm(path.join(rootDir, distDir), { force: true, recursive: true });

  const child = spawn(nextBin, ["build"], {
    cwd: rootDir,
    env: {
      ...process.env,
      BIDTOOL_NEXT_DIST_DIR: distDir,
      NODE_ENV: "production",
    },
    stdio: "inherit",
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[build-next] ${message}`);
  process.exit(1);
});
