import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CommandResult = {
  code: number;
  stderr: string;
  stdout: string;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const rootName = path.basename(rootDir).toLowerCase();
const defaultDelayMs = 0;
const devPorts = [3000, 3001];
const composeServiceNames = ["postgres", "searxng", "searxng-valkey"];
const composeContainerNames = [
  "bidtoolv3-postgres",
  "bidtoolv3-searxng",
  "bidtoolv3-searxng-valkey",
];

function readDelayMs() {
  const delayArg = process.argv.find((arg) => arg.startsWith("--delay="));
  if (!delayArg) return defaultDelayMs;

  const rawDelay = delayArg.split("=", 2)[1];
  const delayMs = Number(rawDelay);
  if (!Number.isFinite(delayMs) || delayMs < 0) return defaultDelayMs;
  return delayMs;
}

function shouldKeepDocker() {
  return process.argv.includes("--keep-docker");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string) {
  console.log(`[kill-local-dev] ${message}`);
}

async function runCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      shell: false,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      resolve({
        code: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout,
      });
    });

    child.once("close", (code) => {
      resolve({
        code: code ?? 1,
        stderr,
        stdout,
      });
    });
  });
}

async function stopDockerCompose() {
  if (shouldKeepDocker()) {
    log("Skipping Docker Compose shutdown (--keep-docker).");
    return;
  }

  const args = [
    "compose",
    "--profile",
    "search",
    "stop",
    ...composeServiceNames,
  ];
  const result = await runCommand("docker", args);

  if (result.code === 0) {
    log(`Stopped Docker Compose services: ${composeServiceNames.join(", ")}.`);
  } else {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(
      Boolean,
    );
    log(
      `Docker Compose stop failed: docker ${args.join(" ")}.${
        details.length ? ` ${details.join(" ")}` : ""
      }`,
    );
  }

  await stopComposeContainersByName();
}

async function getRunningComposeContainerIds() {
  const ids = new Set<string>();

  const byProject = await runCommand("docker", [
    "ps",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${rootName}`,
  ]);

  if (byProject.code === 0) {
    for (const line of byProject.stdout.split(/\r?\n/)) {
      const id = line.trim();
      if (id) ids.add(id);
    }
  }

  for (const name of composeContainerNames) {
    const byName = await runCommand("docker", [
      "ps",
      "-q",
      "--filter",
      `name=^/${name}$`,
    ]);

    if (byName.code !== 0) continue;

    for (const line of byName.stdout.split(/\r?\n/)) {
      const id = line.trim();
      if (id) ids.add(id);
    }
  }

  return Array.from(ids);
}

async function stopComposeContainersByName() {
  const ids = await getRunningComposeContainerIds();
  if (ids.length === 0) {
    log("Docker containers are already stopped.");
    return;
  }

  const result = await runCommand("docker", ["stop", ...ids]);

  if (result.code === 0) {
    log(`Stopped Docker containers: ${ids.join(", ")}.`);
    return;
  }

  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean);
  log(
    `Docker container stop fallback failed.${
      details.length ? ` ${details.join(" ")}` : ""
    }`,
  );
}

function parsePid(value: string) {
  const pid = Number(value.trim());
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null;
  return pid;
}

async function getUnixPortPids() {
  const pids = new Set<number>();

  for (const port of devPorts) {
    const result = await runCommand("lsof", [
      "-tiTCP",
      `:${port}`,
      "-sTCP:LISTEN",
    ]);
    if (result.code !== 0) continue;

    for (const line of result.stdout.split(/\r?\n/)) {
      const pid = parsePid(line);
      if (pid) pids.add(pid);
    }
  }

  return pids;
}

async function getUnixProjectPids() {
  const pids = new Set<number>();
  const result = await runCommand("ps", ["-eo", "pid=,command="]);
  if (result.code !== 0) return pids;

  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;

    const pid = parsePid(match[1] ?? "");
    const command = match[2] ?? "";
    const normalizedCommand = command.toLowerCase();
    if (!pid || normalizedCommand.includes("kill-local-dev")) continue;

    const referencesProject =
      command.includes(rootDir) || normalizedCommand.includes(rootName);
    const looksLikeDevProcess =
      normalizedCommand.includes("next dev") ||
      normalizedCommand.includes("next/dist/bin/next") ||
      normalizedCommand.includes("scripts/local-dev.ts") ||
      normalizedCommand.includes("bun run dev") ||
      normalizedCommand.includes("bun run start:dev");

    if (referencesProject && looksLikeDevProcess) {
      pids.add(pid);
    }
  }

  return pids;
}

async function getWindowsPids() {
  const escapedRoot = rootDir.replace(/'/g, "''");
  const escapedRootName = rootName.replace(/'/g, "''");
  const ports = devPorts.join(",");
  const command = `
$ports = @(${ports})
$ids = @()
try {
  $ids += Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
} catch {}
$root = '${escapedRoot}'
$rootName = '${escapedRootName}'
$current = ${process.pid}
$ids += Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $current -and
    $_.CommandLine -and
    $_.CommandLine -notmatch 'kill-local-dev' -and
    (($_.CommandLine -like "*$root*") -or ($_.CommandLine.ToLower().Contains($rootName))) -and
    ($_.CommandLine -match 'next dev|next/dist/bin/next|scripts/local-dev.ts|bun.*dev|bun.*start:dev')
  } |
  Select-Object -ExpandProperty ProcessId
$ids | Sort-Object -Unique
`;
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ]);

  const pids = new Set<number>();
  if (result.code !== 0) return pids;

  for (const line of result.stdout.split(/\r?\n/)) {
    const pid = parsePid(line);
    if (pid) pids.add(pid);
  }

  return pids;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPid(pid: number) {
  if (!isProcessAlive(pid)) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  await sleep(700);
  if (!isProcessAlive(pid)) return true;

  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

async function stopLocalDevProcesses() {
  const pids =
    process.platform === "win32"
      ? await getWindowsPids()
      : new Set([
          ...(await getUnixPortPids()),
          ...(await getUnixProjectPids()),
        ]);

  if (pids.size === 0) {
    log("No BidTool dev processes found.");
    return;
  }

  log(`Stopping process IDs: ${Array.from(pids).join(", ")}`);

  for (const pid of pids) {
    const stopped = await stopPid(pid);
    log(`${stopped ? "Stopped" : "Could not stop"} PID ${pid}.`);
  }
}

async function main() {
  const delayMs = readDelayMs();
  if (delayMs > 0) {
    log(`Waiting ${delayMs}ms before shutdown.`);
    await sleep(delayMs);
  }

  await stopDockerCompose();
  await stopLocalDevProcesses();
  log("Local shutdown complete.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[kill-local-dev] ${message}`);
  process.exitCode = 1;
});
