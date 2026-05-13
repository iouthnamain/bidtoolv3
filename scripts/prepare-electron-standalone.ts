import { access, cp, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const standaloneDir = path.join(rootDir, ".next", "standalone");
const staticSourceDir = path.join(rootDir, ".next", "static");
const staticTargetDir = path.join(standaloneDir, ".next", "static");
const publicSourceDir = path.join(rootDir, "public");
const publicTargetDir = path.join(standaloneDir, "public");

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyFresh(source: string, target: string) {
  if (!(await pathExists(source))) {
    return;
  }

  await rm(target, { force: true, recursive: true });
  await cp(source, target, { recursive: true });
}

async function main() {
  if (!(await pathExists(path.join(standaloneDir, "server.js")))) {
    throw new Error(
      "Missing .next/standalone/server.js. Run `bun run build` first.",
    );
  }

  await copyFresh(staticSourceDir, staticTargetDir);
  await copyFresh(publicSourceDir, publicTargetDir);
  console.log("Prepared Next standalone assets for Electron.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[desktop-prepare] ${message}`);
  process.exit(1);
});
