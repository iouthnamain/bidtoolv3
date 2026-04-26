import { spawn } from "node:child_process";

import { TRPCError } from "@trpc/server";

import { env } from "~/env";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

type RunResult = {
  command: string;
  exitCode: number;
  output: string;
  startedAt: string;
  finishedAt: string;
};

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

async function runCommand(
  label: string,
  command: string,
  args: string[],
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
    const result = await new Promise<RunResult>((resolve, reject) => {
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
          command: `${command} ${args.join(" ")}`.trim(),
          exitCode: code ?? -1,
          output: chunks.join(""),
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      });
    });
    return result;
  } finally {
    runningTask = null;
    runningTaskStartedAt = null;
  }
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

export const maintenanceRouter = createTRPCRouter({
  status: publicProcedure.query(async () => {
    const enabled = env.NODE_ENV === "development";

    return {
      dockerServices: enabled
        ? await readDockerServicesStatus()
        : dockerServices,
      enabled,
      runningTask,
      runningTaskStartedAt,
    };
  }),

  runDockerStack: publicProcedure.mutation(() =>
    runCommand("docker:up", "docker", [
      "compose",
      "--profile",
      "search",
      "up",
      "-d",
      "postgres",
      "searxng",
    ]),
  ),

  runDockerStop: publicProcedure.mutation(() =>
    runCommand("docker:stop", "docker", [
      "compose",
      "--profile",
      "search",
      "stop",
      "postgres",
      "searxng",
      "searxng-valkey",
    ]),
  ),

  runSetup: publicProcedure.mutation(() =>
    runCommand("setup", bunCommand, ["run", "dev:install"]),
  ),

  runUpdate: publicProcedure.mutation(() =>
    runCommand("update", bunCommand, ["run", "dev:update"]),
  ),

  runMigrate: publicProcedure.mutation(() =>
    runCommand("db:migrate", bunCommand, ["run", "db:migrate"]),
  ),

  runKillAll: publicProcedure.mutation(() =>
    runDetachedCommand(
      "kill:all",
      bunCommand,
      ["run", "./scripts/kill-local-dev.ts", "--delay=1200"],
      [
        "Đã lên lịch dừng toàn bộ tiến trình local của BidTool.",
        "Docker chỉ được dừng bằng `docker compose stop`; không xóa containers hoặc volumes.",
        "Trang này có thể mất kết nối sau vài giây vì Next.js dev server sẽ bị dừng.",
        "Mở lại bằng `launch-maintenance.bat` hoặc `bun run dev:run` khi cần tiếp tục.",
      ].join("\n"),
    ),
  ),
});
