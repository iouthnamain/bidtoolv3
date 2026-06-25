import { spawn } from "node:child_process";
import { access, copyFile, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type WorkflowCommand = "install" | "run" | "update";

type CommandResult = {
  code: number;
  stderr: string;
  stdout: string;
  timedOut?: boolean;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const envPath = path.join(rootDir, ".env");
const envExamplePath = path.join(rootDir, ".env.example");
const bunExecutable = process.execPath;
const defaultDatabasePort = 5432;
const databaseReadyAttempts = 30;
const databaseReadyDelayMs = 2_000;
const migrationAttempts = 3;
const migrationRetryDelayMs = 2_000;

function isWorkflowCommand(
  value: string | undefined,
): value is WorkflowCommand {
  return value === "install" || value === "run" || value === "update";
}

function assertBunRuntime(): void {
  const bunVersion = (process.versions as Record<string, string | undefined>)
    .bun;
  if (typeof bunVersion === "string" && bunVersion.length > 0) {
    return;
  }

  throw new Error(
    "This workflow helper must run with Bun. Use `bun run dev:install`, `bun run dev:update`, or `bun run dev:run`.",
  );
}

function commandLabel(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logStep(message: string): void {
  console.log(`\n[local-dev] ${message}`);
}

function trimOutput(output: string): string {
  return output.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    inheritStdio?: boolean;
    // When set, the child is killed after this many ms and the result is
    // returned with `timedOut: true`. Used for non-essential steps (e.g. the
    // Playwright Chromium install) that can hang on some platforms and must
    // never block startup.
    timeoutMs?: number;
  },
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd ?? rootDir,
      env: process.env,
      shell: false,
      stdio: options?.inheritStdio ? "inherit" : "pipe",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        // SIGTERM first; force-kill shortly after if it ignores it. On Windows
        // child.kill() maps to TerminateProcess, which is sufficient here.
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
      }, options.timeoutMs);
      timer.unref?.();
    }

    if (!options?.inheritStdio) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }

    child.once("error", (error: NodeJS.ErrnoException) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (settled) {
        return;
      }
      settled = true;
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Unable to find \`${command}\` on PATH. Install it first, then rerun your Bun workflow command.`,
          ),
        );
        return;
      }

      reject(error);
    });

    child.once("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        code: code ?? 1,
        stderr,
        stdout,
        timedOut,
      });
    });
  });
}

async function runCheckedCommand(
  command: string,
  args: string[],
  description: string,
): Promise<void> {
  logStep(description);
  const result = await runCommand(command, args, { inheritStdio: true });

  if (result.code === 0) {
    return;
  }

  throw new Error(
    `Command exited with code ${result.code}: ${commandLabel(command, args)}`,
  );
}

async function ensureEnvFile(): Promise<void> {
  try {
    await access(envPath);
    logStep("Reusing existing .env");
    return;
  } catch {
    // Fall through and create from the template below.
  }

  try {
    await access(envExamplePath);
  } catch {
    throw new Error(
      "Cannot create .env because .env.example is missing from the project root.",
    );
  }

  await copyFile(envExamplePath, envPath);
  logStep("Created .env from .env.example");
}

function parseEnvValue(contents: string, key: string): string | null {
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(key)}\\s*=\\s*(.*)\\s*$`,
    "m",
  );
  const match = contents.match(pattern);
  if (!match) {
    return null;
  }

  const [, rawValue] = match;
  if (typeof rawValue !== "string") {
    return null;
  }

  let value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

async function readDatabaseConfig(): Promise<{ host: string; port: number }> {
  const envContents = await readFile(envPath, "utf8");
  const databaseUrl = parseEnvValue(envContents, "DATABASE_URL");

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing from .env.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL in .env is not a valid URL.");
  }

  const port = parsedUrl.port ? Number(parsedUrl.port) : defaultDatabasePort;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("DATABASE_URL in .env uses an invalid port.");
  }

  return {
    host: parsedUrl.hostname || "localhost",
    port,
  };
}

async function canConnectToPort(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(2_000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function ensureDockerIsReady(): Promise<void> {
  logStep("Checking Docker CLI");
  const composeVersion = await runCommand("docker", ["compose", "version"]);
  if (composeVersion.code !== 0) {
    throw new Error(
      [
        "Docker Compose is unavailable.",
        "Install Docker with the Compose plugin and try again.",
        trimOutput(composeVersion.stderr) || trimOutput(composeVersion.stdout),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  logStep("Checking Docker daemon");
  const dockerInfo = await runCommand("docker", ["info"]);
  if (dockerInfo.code !== 0) {
    throw new Error(
      [
        "Docker is installed but the daemon is not running.",
        "Start Docker Desktop or the Docker service, then rerun the workflow.",
        trimOutput(dockerInfo.stderr) || trimOutput(dockerInfo.stdout),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function ensureDockerStack(): Promise<void> {
  await runCheckedCommand(
    "docker",
    ["compose", "up", "-d", "postgres", "searxng"],
    "Starting PostgreSQL and SearXNG containers",
  );
}

async function waitForDatabaseSocket(): Promise<void> {
  const database = await readDatabaseConfig();
  logStep(`Waiting for PostgreSQL at ${database.host}:${database.port}`);

  for (let attempt = 1; attempt <= databaseReadyAttempts; attempt += 1) {
    if (await canConnectToPort(database.host, database.port)) {
      return;
    }

    if (attempt < databaseReadyAttempts) {
      await sleep(databaseReadyDelayMs);
    }
  }

  throw new Error(
    `PostgreSQL did not become reachable at ${database.host}:${database.port} within ${Math.round((databaseReadyAttempts * databaseReadyDelayMs) / 1_000)} seconds.`,
  );
}

async function runMigrations(): Promise<void> {
  for (let attempt = 1; attempt <= migrationAttempts; attempt += 1) {
    logStep(
      attempt === 1
        ? "Applying database migrations"
        : `Retrying database migrations (${attempt}/${migrationAttempts})`,
    );

    const result = await runCommand(bunExecutable, ["run", "db:migrate"], {
      inheritStdio: true,
    });
    if (result.code === 0) {
      return;
    }

    if (attempt < migrationAttempts) {
      await sleep(migrationRetryDelayMs);
      continue;
    }

    throw new Error(
      `Database migration failed after ${migrationAttempts} attempts.`,
    );
  }
}

async function installDependencies(): Promise<void> {
  await runCheckedCommand(
    bunExecutable,
    ["install"],
    "Installing project dependencies",
  );
}

async function verifyPlaywrightChromium(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      timeout: 15_000,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

async function installScrapeBrowser(): Promise<void> {
  // The shop scraper launches Playwright's Chromium when no system
  // Chrome/Edge is found. Verify with a real launch (not just cache
  // folder names) so broken/partial installs are repaired automatically.
  if (await verifyPlaywrightChromium()) {
    logStep("Playwright Chromium ready for the shop scraper");
    return;
  }

  const installTimeoutMs = 5 * 60 * 1_000;
  const installAttempts: string[][] = [[], ["--force"]];

  for (const extraArgs of installAttempts) {
    logStep(
      extraArgs.length > 0
        ? "Reinstalling Playwright Chromium for the shop scraper (--force)"
        : "Installing Playwright Chromium for the shop scraper",
    );

    const result = await runCommand(
      bunExecutable,
      ["x", "playwright", "install", "chromium", ...extraArgs],
      { inheritStdio: true, timeoutMs: installTimeoutMs },
    );

    if (result.timedOut) {
      if (await verifyPlaywrightChromium()) {
        logStep(
          "Playwright Chromium downloaded; the installer did not exit cleanly but scraping works. Continuing.",
        );
        return;
      }
      continue;
    }

    if (await verifyPlaywrightChromium()) {
      return;
    }
  }

  const linuxHint =
    process.platform === "linux"
      ? " On Ubuntu, also try: sudo bunx playwright install-deps chromium"
      : "";
  logStep(
    `Could not install a working Playwright Chromium for scraping. Run manually: bunx playwright install chromium --force.${linuxHint} Or install Google Chrome / Chromium system-wide.`,
  );
}

async function prepareLocalDatabase(): Promise<void> {
  await ensureEnvFile();
  await ensureDockerIsReady();
  await ensureDockerStack();
  await waitForDatabaseSocket();
  await runMigrations();
}

async function runInstallWorkflow(): Promise<void> {
  await installDependencies();
  await installScrapeBrowser();
  await prepareLocalDatabase();
}

async function runUpdateWorkflow(): Promise<void> {
  await installDependencies();
  await installScrapeBrowser();
  await prepareLocalDatabase();
}

async function startDevServer(): Promise<void> {
  await runCheckedCommand(
    bunExecutable,
    ["run", "dev"],
    "Starting Next.js development server",
  );
}

async function runDevWorkflow(): Promise<void> {
  await installScrapeBrowser();
  await prepareLocalDatabase();
  await startDevServer();
}

async function main(): Promise<void> {
  assertBunRuntime();

  const commandArg = process.argv[2];
  if (!isWorkflowCommand(commandArg)) {
    throw new Error(
      "Missing workflow command. Use one of: install, update, run.",
    );
  }

  switch (commandArg) {
    case "install":
      await runInstallWorkflow();
      return;
    case "run":
      await runDevWorkflow();
      return;
    case "update":
      await runUpdateWorkflow();
      return;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[local-dev] ${message}`);
  process.exitCode = 1;
});
