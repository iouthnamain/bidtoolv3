import { access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveNextBuildCommand() {
  const binName = process.platform === "win32" ? "next.cmd" : "next";
  const nextBin = path.join(rootDir, "node_modules", ".bin", binName);
  if (await pathExists(nextBin)) {
    return {
      args: ["build"],
      command: nextBin,
    };
  }

  const nextCli = path.join(
    rootDir,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  if (await pathExists(nextCli)) {
    return {
      args: [nextCli, "build"],
      command: process.env.NODE ?? "node",
    };
  }

  throw new Error(
    "Unable to find the Next.js CLI. Run `bun install` before building.",
  );
}

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
  const nextBuild = await resolveNextBuildCommand();

  const child = spawn(nextBuild.command, nextBuild.args, {
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
