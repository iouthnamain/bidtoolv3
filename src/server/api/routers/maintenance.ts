import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { TRPCError } from "@trpc/server";

import { env } from "~/env";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { type db as appDb } from "~/server/db";
import { notifications } from "~/server/db/schema";

type RunResult = {
  command: string;
  exitCode: number;
  output: string;
  startedAt: string;
  finishedAt: string;
};

type MaintenanceRunResult = RunResult & {
  versionInfo: AppVersionInfo;
};

type CommandSpec = {
  command: string;
  args: string[];
  heading?: string;
};

type GitVersionInfo = {
  available: boolean;
  branch: string | null;
  commit: string | null;
  commitShort: string | null;
  commitDate: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  error: string | null;
};

type AppVersionInfo = {
  packageName: string;
  version: string;
  packageManager: string | null;
  checkedAt: string;
  upstreamVersion: string | null;
  updateAvailable: boolean;
  versionUpdateAvailable: boolean;
  git: GitVersionInfo;
};

type AppDb = typeof appDb;

type DockerServiceStatus = {
  containerName: string;
  key: "postgres" | "searxng" | "searxng-valkey";
  label: string;
  running: boolean;
  status: string;
};

let runningTask: string | null = null;
let runningTaskStartedAt: string | null = null;
const bunCommand = "bun";
const packageJsonPath = path.join(process.cwd(), "package.json");
const dockerServices: DockerServiceStatus[] = [
  {
    containerName: "bidtoolv3-postgres",
    key: "postgres",
    label: "Postgres",
    running: false,
    status: "unknown",
  },
  {
    containerName: "bidtoolv3-searxng",
    key: "searxng",
    label: "SearXNG",
    running: false,
    status: "unknown",
  },
  {
    containerName: "bidtoolv3-searxng-valkey",
    key: "searxng-valkey",
    label: "SearXNG Valkey",
    running: false,
    status: "unknown",
  },
];

function assertDevOnly() {
  if (env.NODE_ENV !== "development") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Lệnh bảo trì chỉ có thể chạy trong môi trường development.",
    });
  }
}

function renderCommand(command: string, args: string[]) {
  return `${command} ${args.join(" ")}`.trim();
}

async function readProcessResult(command: string, args: string[]) {
  return await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
    });
    child.stderr.on("data", (data: string) => {
      stderr += data;
    });

    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runProcess(command: string, args: string[]) {
  return await new Promise<{ exitCode: number; output: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
      });

      const chunks: string[] = [];
      child.stdout.on("data", (data: Buffer) => chunks.push(data.toString()));
      child.stderr.on("data", (data: Buffer) => chunks.push(data.toString()));

      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? -1,
          output: chunks.join(""),
        });
      });
    },
  );
}

async function runCommandSequence(
  label: string,
  commands: CommandSpec[],
): Promise<RunResult> {
  assertDevOnly();

  if (runningTask) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Đang chạy: ${runningTask}. Vui lòng chờ tác vụ hiện tại kết thúc.`,
    });
  }

  runningTask = label;
  const startedAt = new Date().toISOString();
  runningTaskStartedAt = startedAt;

  try {
    const outputChunks: string[] = [];
    let exitCode = 0;

    for (const [index, spec] of commands.entries()) {
      const commandLabel = renderCommand(spec.command, spec.args);
      if (commands.length > 1 || spec.heading) {
        outputChunks.push(
          [
            index > 0 ? "\n" : "",
            `[maintenance] ${spec.heading ?? commandLabel}`,
            `> ${commandLabel}`,
            "",
          ].join("\n"),
        );
      }

      const result = await runProcess(spec.command, spec.args);
      outputChunks.push(result.output);
      exitCode = result.exitCode;

      if (exitCode !== 0) {
        break;
      }
    }

    return {
      command: commands
        .map((spec) => renderCommand(spec.command, spec.args))
        .join(" && "),
      exitCode,
      output: outputChunks.join(""),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    runningTask = null;
    runningTaskStartedAt = null;
  }
}

function runCommand(
  label: string,
  command: string,
  args: string[],
): Promise<RunResult> {
  return runCommandSequence(label, [{ command, args }]);
}

async function readGitText(args: string[]) {
  const result = await readProcessResult("git", args);
  if (result.code !== 0) {
    return null;
  }

  return (result.stdout || result.stderr).trim();
}

function parsePackageJson(contents: string): {
  name: string;
  version: string;
  packageManager: string | null;
} {
  const parsed = JSON.parse(contents) as {
    name?: unknown;
    version?: unknown;
    packageManager?: unknown;
  };

  return {
    name: typeof parsed.name === "string" ? parsed.name : "bidtoolv3",
    version: typeof parsed.version === "string" ? parsed.version : "unknown",
    packageManager:
      typeof parsed.packageManager === "string" ? parsed.packageManager : null,
  };
}

async function readPackageInfo() {
  try {
    return parsePackageJson(await readFile(packageJsonPath, "utf8"));
  } catch {
    return {
      name: "bidtoolv3",
      version: "unknown",
      packageManager: null,
    };
  }
}

async function readUpstreamPackageVersion(upstream: string | null) {
  if (!upstream) {
    return null;
  }

  const contents = await readGitText(["show", `${upstream}:package.json`]);
  if (!contents) {
    return null;
  }

  try {
    return parsePackageJson(contents).version;
  } catch {
    return null;
  }
}

async function readGitVersionInfo(): Promise<GitVersionInfo> {
  const insideWorkTree = await readGitText([
    "rev-parse",
    "--is-inside-work-tree",
  ]);

  if (insideWorkTree !== "true") {
    return {
      ahead: 0,
      available: false,
      behind: 0,
      branch: null,
      commit: null,
      commitDate: null,
      commitShort: null,
      dirty: false,
      error: "Không tìm thấy Git worktree.",
      upstream: null,
    };
  }

  const [branch, commit, commitDate, upstream, status] = await Promise.all([
    readGitText(["rev-parse", "--abbrev-ref", "HEAD"]),
    readGitText(["rev-parse", "HEAD"]),
    readGitText(["log", "-1", "--format=%cI"]),
    readGitText([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]),
    readGitText(["status", "--porcelain"]),
  ]);

  let ahead = 0;
  let behind = 0;

  if (upstream) {
    const counts = await readGitText([
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${upstream}`,
    ]);
    const [aheadRaw, behindRaw] = counts?.split(/\s+/) ?? [];
    ahead = Number(aheadRaw) || 0;
    behind = Number(behindRaw) || 0;
  }

  return {
    ahead,
    available: true,
    behind,
    branch,
    commit,
    commitDate,
    commitShort: commit ? commit.slice(0, 7) : null,
    dirty: !!status,
    error: null,
    upstream,
  };
}

async function readAppVersionInfo(): Promise<AppVersionInfo> {
  const [packageInfo, git] = await Promise.all([
    readPackageInfo(),
    readGitVersionInfo(),
  ]);
  const upstreamVersion = await readUpstreamPackageVersion(git.upstream);
  const versionUpdateAvailable =
    git.behind > 0 &&
    !!upstreamVersion &&
    upstreamVersion !== packageInfo.version;

  return {
    checkedAt: new Date().toISOString(),
    git,
    packageManager: packageInfo.packageManager,
    packageName: packageInfo.name,
    updateAvailable: git.behind > 0,
    upstreamVersion,
    version: packageInfo.version,
    versionUpdateAvailable,
  };
}

function formatDurationSeconds(startedAt: string, finishedAt: string) {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "không rõ thời lượng";
  }
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

async function recordMaintenanceNotification({
  after,
  before,
  db,
  displayName,
  mode = "always",
  result,
}: {
  after: AppVersionInfo;
  before: AppVersionInfo;
  db: AppDb;
  displayName: string;
  mode?: "always" | "update-available";
  result: RunResult;
}) {
  const failed = result.exitCode !== 0;
  const versionChanged = before.version !== after.version;

  if (!failed && mode === "update-available" && !after.updateAvailable) {
    return;
  }

  const title = failed
    ? `${displayName} bị lỗi`
    : versionChanged
      ? `BidTool đã cập nhật lên v${after.version}`
      : after.updateAvailable && mode === "update-available"
        ? "Có bản cập nhật BidTool"
        : `${displayName} hoàn tất`;

  const bodyParts = [
    `Lệnh: ${result.command}.`,
    `Exit ${result.exitCode}, ${formatDurationSeconds(
      result.startedAt,
      result.finishedAt,
    )}.`,
  ];

  if (versionChanged) {
    bodyParts.push(`Phiên bản: ${before.version} -> ${after.version}.`);
  } else {
    bodyParts.push(`Phiên bản hiện tại: ${after.version}.`);
  }

  if (after.git.behind > 0) {
    bodyParts.push(`Còn ${after.git.behind} commit mới trên upstream.`);
  }

  try {
    await db.insert(notifications).values({
      body: bodyParts.join(" "),
      channel: "in_app",
      createdAt: result.finishedAt,
      isRead: false,
      severity: failed ? "high" : after.updateAvailable ? "medium" : "low",
      title,
    });
  } catch (error) {
    console.warn("Unable to record maintenance notification", error);
  }
}

async function runMaintenanceCommand({
  args,
  command,
  db,
  displayName,
  label,
  mode,
}: {
  args: string[];
  command: string;
  db: AppDb;
  displayName: string;
  label: string;
  mode?: "always" | "update-available";
}): Promise<MaintenanceRunResult> {
  const before = await readAppVersionInfo();
  const result = await runCommand(label, command, args);
  const after = await readAppVersionInfo();
  await recordMaintenanceNotification({
    after,
    before,
    db,
    displayName,
    mode,
    result,
  });
  return { ...result, versionInfo: after };
}

async function runMaintenanceSequence({
  commands,
  db,
  displayName,
  label,
}: {
  commands: CommandSpec[];
  db: AppDb;
  displayName: string;
  label: string;
}): Promise<MaintenanceRunResult> {
  const before = await readAppVersionInfo();
  const result = await runCommandSequence(label, commands);
  const after = await readAppVersionInfo();
  await recordMaintenanceNotification({
    after,
    before,
    db,
    displayName,
    result,
  });
  return { ...result, versionInfo: after };
}

async function readDockerServiceStatus(
  service: DockerServiceStatus,
): Promise<DockerServiceStatus> {
  const result = await new Promise<{ code: number; output: string }>(
    (resolve) => {
      const child = spawn(
        "docker",
        [
          "inspect",
          "--format",
          "{{.State.Running}}|{{.State.Status}}",
          service.containerName,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
        },
      );

      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        output += data;
      });
      child.on("error", () => resolve({ code: 1, output: "" }));
      child.on("close", (code) => {
        resolve({ code: code ?? 1, output });
      });
    },
  );

  if (result.code !== 0) {
    return {
      ...service,
      running: false,
      status: "missing",
    };
  }

  const [runningRaw, statusRaw] = result.output.trim().split("|");
  return {
    ...service,
    running: runningRaw === "true",
    status: statusRaw?.trim() ?? "unknown",
  };
}

async function readDockerServicesStatus() {
  return Promise.all(dockerServices.map(readDockerServiceStatus));
}

async function runDetachedCommand(
  label: string,
  command: string,
  args: string[],
  output: string,
): Promise<RunResult> {
  assertDevOnly();

  if (runningTask) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Đang chạy: ${runningTask}. Vui lòng chờ tác vụ hiện tại kết thúc.`,
    });
  }

  runningTask = label;
  const startedAt = new Date().toISOString();
  runningTaskStartedAt = startedAt;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        detached: true,
        env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
        shell: false,
        stdio: "ignore",
      });

      const timeoutId = setTimeout(() => {
        child.removeAllListeners("error");
        child.unref();
        resolve();
      }, 150);

      child.once("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    return {
      command: `${command} ${args.join(" ")}`.trim(),
      exitCode: 0,
      finishedAt: new Date().toISOString(),
      output,
      startedAt,
    };
  } finally {
    runningTask = null;
    runningTaskStartedAt = null;
  }
}

async function runDetachedMaintenanceCommand({
  args,
  command,
  db,
  displayName,
  label,
  output,
}: {
  args: string[];
  command: string;
  db: AppDb;
  displayName: string;
  label: string;
  output: string;
}): Promise<MaintenanceRunResult> {
  const before = await readAppVersionInfo();
  const result = await runDetachedCommand(label, command, args, output);
  const after = await readAppVersionInfo();
  await recordMaintenanceNotification({
    after,
    before,
    db,
    displayName,
    result,
  });
  return { ...result, versionInfo: after };
}

export const maintenanceRouter = createTRPCRouter({
  status: publicProcedure.query(async () => {
    const enabled = env.NODE_ENV === "development";
    const [dockerServicesStatus, versionInfo] = await Promise.all([
      enabled ? readDockerServicesStatus() : Promise.resolve(dockerServices),
      readAppVersionInfo(),
    ]);

    return {
      dockerServices: dockerServicesStatus,
      enabled,
      runningTask,
      runningTaskStartedAt,
      versionInfo,
    };
  }),

  version: publicProcedure.query(() => readAppVersionInfo()),

  checkForUpdates: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceCommand({
      args: ["fetch", "--prune"],
      command: "git",
      db: ctx.db,
      displayName: "Kiểm tra bản cập nhật",
      label: "git:fetch",
      mode: "update-available",
    }),
  ),

  runDockerStack: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceCommand({
      args: [
        "compose",
        "--profile",
        "search",
        "up",
        "-d",
        "postgres",
        "searxng",
      ],
      command: "docker",
      db: ctx.db,
      displayName: "Khởi động Docker",
      label: "docker:up",
    }),
  ),

  runDockerStop: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceCommand({
      args: [
        "compose",
        "--profile",
        "search",
        "stop",
        "postgres",
        "searxng",
        "searxng-valkey",
      ],
      command: "docker",
      db: ctx.db,
      displayName: "Dừng Docker",
      label: "docker:stop",
    }),
  ),

  runSetup: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceCommand({
      args: ["run", "dev:install"],
      command: bunCommand,
      db: ctx.db,
      displayName: "Chạy setup",
      label: "setup",
    }),
  ),

  runCodePull: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceCommand({
      args: ["pull", "--ff-only"],
      command: "git",
      db: ctx.db,
      displayName: "Pull code",
      label: "git:pull",
    }),
  ),

  runUpdate: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceCommand({
      args: ["run", "dev:update"],
      command: bunCommand,
      db: ctx.db,
      displayName: "Chạy update",
      label: "update",
    }),
  ),

  runFullUpdate: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceSequence({
      commands: [
        {
          args: ["pull", "--ff-only"],
          command: "git",
          heading: "Pull code mới",
        },
        {
          args: ["run", "dev:update"],
          command: bunCommand,
          heading: "Đồng bộ deps, services và migrations",
        },
      ],
      db: ctx.db,
      displayName: "Cập nhật đầy đủ",
      label: "full:update",
    }),
  ),

  runMigrate: publicProcedure.mutation(({ ctx }) =>
    runMaintenanceCommand({
      args: ["run", "db:migrate"],
      command: bunCommand,
      db: ctx.db,
      displayName: "Áp migrations",
      label: "db:migrate",
    }),
  ),

  runKillAll: publicProcedure.mutation(({ ctx }) =>
    runDetachedMaintenanceCommand({
      args: ["run", "./scripts/kill-local-dev.ts", "--delay=1200"],
      command: bunCommand,
      db: ctx.db,
      displayName: "Dừng toàn bộ",
      label: "kill:all",
      output: [
        "Đã lên lịch dừng toàn bộ tiến trình local của BidTool.",
        "Docker chỉ được dừng bằng `docker compose stop`; không xóa containers hoặc volumes.",
        "Trang này có thể mất kết nối sau vài giây vì Next.js dev server sẽ bị dừng.",
        "Mở lại bằng `launch-maintenance.bat` hoặc `bun run dev:run` khi cần tiếp tục.",
      ].join("\n"),
    }),
  ),
});
