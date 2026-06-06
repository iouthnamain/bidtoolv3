import { spawn } from "node:child_process";
import { access, cp, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const nextDistDirName = resolveNextDistDir();
const nextDistDir = path.join(rootDir, nextDistDirName);
const standaloneDir = path.join(nextDistDir, "standalone");
const standaloneServerPath = path.join(standaloneDir, "server.js");
const staticSourceDir = path.join(nextDistDir, "static");
const staticTargetDir = path.join(standaloneDir, nextDistDirName, "static");
const publicSourceDir = path.join(rootDir, "public");
const publicTargetDir = path.join(standaloneDir, "public");

function resolveNextDistDir() {
  const rawDistDir = process.env.BIDTOOL_NEXT_DIST_DIR?.trim() || ".next";

  if (path.isAbsolute(rawDistDir) || rawDistDir.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid Next output directory '${rawDistDir}'.`);
  }

  return rawDistDir;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyFresh(source, target) {
  if (!(await pathExists(source))) {
    return;
  }

  await rm(target, { force: true, recursive: true });
  await cp(source, target, { recursive: true });
}

async function main() {
  if (!(await pathExists(standaloneServerPath))) {
    throw new Error(
      `Missing ${nextDistDirName}/standalone/server.js. Run \`bun run build\` first.`,
    );
  }

  await copyFresh(staticSourceDir, staticTargetDir);
  await copyFresh(publicSourceDir, publicTargetDir);

  const server = spawn(process.execPath, [standaloneServerPath], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.kill(signal);
    });
  }

  const exitCode = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code, signal) => {
      if (signal) {
        resolve(0);
        return;
      }

      resolve(code ?? 1);
    });
  });

  process.exit(exitCode);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[start-next-standalone] ${message}`);
  process.exit(1);
});
