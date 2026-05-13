import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const appUrl = process.env.BIDTOOL_DESKTOP_DEV_URL ?? "http://127.0.0.1:3000";
const startupTimeoutMs = 180_000;

let nextProcess: ChildProcess | null = null;
let electronProcess: ChildProcess | null = null;
let shuttingDown = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeUrl(rawUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve(false);
      return;
    }

    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });

    request.setTimeout(1_500, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForApp() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (await probeUrl(appUrl)) {
      return;
    }
    if (nextProcess?.exitCode != null) {
      throw new Error(
        `Next dev server exited with code ${nextProcess.exitCode}.`,
      );
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${appUrl}`);
}

function electronBinaryPath() {
  return path.join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron",
  );
}

function shutdown(exitCode: number) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill();
  }

  process.exit(exitCode);
}

async function main() {
  const alreadyRunning = await probeUrl(appUrl);

  if (!alreadyRunning) {
    nextProcess = spawn(process.execPath, ["run", "dev:run"], {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
    });
  }

  await waitForApp();

  electronProcess = spawn(electronBinaryPath(), ["."], {
    cwd: rootDir,
    env: {
      ...process.env,
      BIDTOOL_DESKTOP_DEV_URL: appUrl,
    },
    stdio: "inherit",
  });

  electronProcess.once("exit", (code) => shutdown(code ?? 0));
  nextProcess?.once("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[desktop-dev] ${message}`);
  shutdown(1);
});
