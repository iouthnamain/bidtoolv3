"use client";

import { useEffect, useState } from "react";
import { DownloadCloud, GitBranch, GitCommit, RefreshCw } from "lucide-react";

import { Badge, Button } from "~/app/_components/ui";
import { type RouterOutputs, api } from "~/trpc/react";

type RunResult = RouterOutputs["maintenance"]["runFullUpdate"];

type TaskKey =
  | "docker"
  | "dockerStop"
  | "checkUpdate"
  | "pull"
  | "setup"
  | "update"
  | "fullUpdate"
  | "migrate"
  | "killAll";

type TaskMeta = {
  key: TaskKey;
  label: string;
  description: string;
  variant: "danger" | "primary" | "secondary";
};

const tasks: TaskMeta[] = [
  {
    key: "docker",
    label: "Khởi động Docker",
    description: "Chạy Postgres, SearXNG và Valkey bằng Docker Compose.",
    variant: "secondary",
  },
  {
    key: "dockerStop",
    label: "Dừng Docker",
    description:
      "Dừng Postgres, SearXNG và Valkey bằng `docker compose stop`. Không xóa container hoặc volume.",
    variant: "secondary",
  },
  {
    key: "setup",
    label: "Chạy setup",
    description:
      "Chạy `bun run dev:install`: cài deps, tạo `.env` nếu thiếu, đảm bảo Postgres + SearXNG, áp migrations.",
    variant: "secondary",
  },
  {
    key: "checkUpdate",
    label: "Kiểm tra bản mới",
    description:
      "Chạy `git fetch --prune` để cập nhật upstream tracking và báo nếu có phiên bản mới.",
    variant: "secondary",
  },
  {
    key: "pull",
    label: "Pull code",
    description:
      "Chạy `git pull --ff-only`. Nếu local có thay đổi xung đột, Git sẽ dừng thay vì tự merge.",
    variant: "secondary",
  },
  {
    key: "update",
    label: "Chạy update",
    description:
      "Chạy `bun run dev:update`: refresh deps, đảm bảo Postgres + SearXNG, áp migrations. `git pull` chạy riêng trước đó.",
    variant: "secondary",
  },
  {
    key: "fullUpdate",
    label: "Cập nhật đầy đủ",
    description:
      "Chạy `git pull --ff-only`, sau đó chạy `bun run dev:update` để đồng bộ code, deps và database.",
    variant: "primary",
  },
  {
    key: "migrate",
    label: "Áp migrations",
    description: "Chỉ chạy `bun run db:migrate` — nhanh khi chỉ có schema mới.",
    variant: "secondary",
  },
  {
    key: "killAll",
    label: "Dừng toàn bộ",
    description:
      "Dừng Docker bằng stop-only và dừng các process dev của BidTool. Trang sẽ mất kết nối sau vài giây.",
    variant: "danger",
  },
];

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "medium",
});

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return dateTimeFormatter.format(parsed);
}

function formatDuration(startedAt: string, finishedAt: string) {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatElapsed(startedAt: string, now: number) {
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return "đang tính";
  const totalSeconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function getTaskLabel(task: string | null | undefined) {
  if (!task) return "Tác vụ bảo trì";
  if (task === "db:migrate") return "Áp migrations";
  if (task === "docker:up") return "Khởi động Docker";
  if (task === "docker:stop") return "Dừng Docker";
  if (task === "git:fetch") return "Kiểm tra bản mới";
  if (task === "git:pull") return "Pull code";
  if (task === "full:update") return "Cập nhật đầy đủ";
  if (task === "kill:all") return "Dừng toàn bộ";
  return tasks.find((item) => item.key === task)?.label ?? task;
}

function isTaskRunning(task: TaskKey, runningTask: string | null | undefined) {
  if (!runningTask) return false;
  return (
    runningTask === task ||
    (task === "docker" && runningTask === "docker:up") ||
    (task === "dockerStop" && runningTask === "docker:stop") ||
    (task === "checkUpdate" && runningTask === "git:fetch") ||
    (task === "pull" && runningTask === "git:pull") ||
    (task === "fullUpdate" && runningTask === "full:update") ||
    (task === "migrate" && runningTask === "db:migrate") ||
    (task === "killAll" && runningTask === "kill:all")
  );
}

function formatCommitDate(value: string | null | undefined) {
  if (!value) return "Không rõ";
  return formatTime(value);
}

function getVersionBadgeTone(
  versionInfo:
    | RouterOutputs["maintenance"]["status"]["versionInfo"]
    | undefined,
) {
  if (!versionInfo?.git.available) return "warning";
  if (versionInfo.updateAvailable) return "warning";
  if (versionInfo.git.dirty) return "info";
  return "success";
}

function getVersionBadgeLabel(
  versionInfo:
    | RouterOutputs["maintenance"]["status"]["versionInfo"]
    | undefined,
) {
  if (!versionInfo?.git.available) return "Git chưa khả dụng";
  if (versionInfo.versionUpdateAvailable && versionInfo.upstreamVersion) {
    return `Có v${versionInfo.upstreamVersion}`;
  }
  if (versionInfo.git.behind > 0) {
    return `Sau ${versionInfo.git.behind} commit`;
  }
  if (versionInfo.git.dirty) return "Có thay đổi local";
  return "Đang mới";
}

export function MaintenancePageClient() {
  const utils = api.useUtils();
  const statusQuery = api.maintenance.status.useQuery(undefined, {
    refetchInterval: 2000,
  });

  const [now, setNow] = useState(() => Date.now());
  const [activeTask, setActiveTask] = useState<TaskKey | null>(null);
  const [lastResult, setLastResult] = useState<
    (RunResult & { task: TaskKey }) | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSuccess = (task: TaskKey) => (data: RunResult) => {
    setLastResult({ ...data, task });
    setActiveTask(null);
    setErrorMessage(null);
    void Promise.all([
      utils.maintenance.status.invalidate(),
      utils.maintenance.version.invalidate(),
      utils.notification.unreadCount.invalidate(),
      utils.notification.list.invalidate(),
      utils.insight.getDashboardSummary.invalidate(),
    ]);
  };

  const handleError = () => (error: { message: string }) => {
    setErrorMessage(error.message);
    setActiveTask(null);
    void Promise.all([
      utils.maintenance.status.invalidate(),
      utils.maintenance.version.invalidate(),
    ]);
  };

  const runDockerStack = api.maintenance.runDockerStack.useMutation({
    onSuccess: handleSuccess("docker"),
    onError: handleError(),
  });
  const runDockerStop = api.maintenance.runDockerStop.useMutation({
    onSuccess: handleSuccess("dockerStop"),
    onError: handleError(),
  });
  const runSetup = api.maintenance.runSetup.useMutation({
    onSuccess: handleSuccess("setup"),
    onError: handleError(),
  });
  const checkForUpdates = api.maintenance.checkForUpdates.useMutation({
    onSuccess: handleSuccess("checkUpdate"),
    onError: handleError(),
  });
  const runCodePull = api.maintenance.runCodePull.useMutation({
    onSuccess: handleSuccess("pull"),
    onError: handleError(),
  });
  const runUpdate = api.maintenance.runUpdate.useMutation({
    onSuccess: handleSuccess("update"),
    onError: handleError(),
  });
  const runFullUpdate = api.maintenance.runFullUpdate.useMutation({
    onSuccess: handleSuccess("fullUpdate"),
    onError: handleError(),
  });
  const runMigrate = api.maintenance.runMigrate.useMutation({
    onSuccess: handleSuccess("migrate"),
    onError: handleError(),
  });
  const runKillAll = api.maintenance.runKillAll.useMutation({
    onSuccess: handleSuccess("killAll"),
    onError: handleError(),
  });

  const isPending =
    runDockerStack.isPending ||
    runDockerStop.isPending ||
    runSetup.isPending ||
    checkForUpdates.isPending ||
    runCodePull.isPending ||
    runUpdate.isPending ||
    runFullUpdate.isPending ||
    runMigrate.isPending ||
    runKillAll.isPending;
  const serverRunningTask = statusQuery.data?.runningTask ?? null;
  const runningTaskStartedAt = statusQuery.data?.runningTaskStartedAt ?? null;
  const isRunning = isPending || !!serverRunningTask;
  const runningLabel = getTaskLabel(activeTask ?? serverRunningTask);
  const enabled = statusQuery.data?.enabled ?? false;
  const versionInfo =
    lastResult?.versionInfo ?? statusQuery.data?.versionInfo ?? undefined;

  useEffect(() => {
    if (!isRunning) return;

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  const handleRun = (task: TaskKey) => {
    if (isRunning) return;
    setActiveTask(task);
    setErrorMessage(null);
    if (task === "docker") runDockerStack.mutate();
    if (task === "dockerStop") runDockerStop.mutate();
    if (task === "setup") runSetup.mutate();
    if (task === "checkUpdate") checkForUpdates.mutate();
    if (task === "pull") runCodePull.mutate();
    if (task === "update") runUpdate.mutate();
    if (task === "fullUpdate") runFullUpdate.mutate();
    if (task === "migrate") runMigrate.mutate();
    if (task === "killAll") runKillAll.mutate();
  };

  if (statusQuery.isPending) {
    return (
      <div className="panel p-4 text-sm text-slate-600">
        Đang kiểm tra trạng thái…
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="panel p-5">
        <Badge tone="warning">Không khả dụng</Badge>
        <h2 className="mt-2 text-base font-bold text-slate-950">
          Chỉ có ở môi trường development
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Các lệnh setup / update / migrate chỉ chạy được khi{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            NODE_ENV=development
          </code>
          . Khởi động bằng <code>bun run start:dev</code> hoặc{" "}
          <code>bun run dev:run</code> để dùng trang này.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section
        id="maintenance-status"
        className={`panel scroll-mt-6 p-4 ${
          isRunning ? "border-sky-200 bg-sky-50/80" : "bg-white/90"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                isRunning
                  ? "bg-sky-700 text-white"
                  : "bg-emerald-50 text-emerald-700"
              }`}
              aria-hidden
            >
              {isRunning ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-current" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-950">
                {isRunning ? "Đang chạy" : "Sẵn sàng"}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {isRunning
                  ? `${runningLabel}${
                      runningTaskStartedAt
                        ? ` · ${formatElapsed(runningTaskStartedAt, now)}`
                        : ""
                    }`
                  : "Không có tác vụ bảo trì nào đang chạy."}
              </p>
            </div>
          </div>
          <Badge tone={isRunning ? "info" : "success"}>
            {isRunning ? "Đang chạy" : "Sẵn sàng"}
          </Badge>
        </div>
      </section>

      <section
        id="maintenance-services"
        className={`panel scroll-mt-6 p-4 ${
          versionInfo?.updateAvailable
            ? "border-amber-200 bg-amber-50/80"
            : "bg-white/90"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="section-title">Phiên bản</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              BidTool v{versionInfo?.version ?? "unknown"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Trạng thái này đọc từ <code>package.json</code>, commit hiện tại
              và upstream tracking của Git. Khi có thay đổi, hệ thống tạo thông
              báo in-app sau khi kiểm tra hoặc chạy update.
            </p>
          </div>
          <Badge tone={getVersionBadgeTone(versionInfo)}>
            {getVersionBadgeLabel(versionInfo)}
          </Badge>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500">
              <GitBranch className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase">Branch</p>
            </div>
            <p className="mt-2 text-sm font-bold text-slate-950">
              {versionInfo?.git.branch ?? "Không rõ"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Upstream: {versionInfo?.git.upstream ?? "chưa cấu hình"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500">
              <GitCommit className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase">Commit</p>
            </div>
            <p className="mt-2 text-sm font-bold text-slate-950">
              {versionInfo?.git.commitShort ?? "Không rõ"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {formatCommitDate(versionInfo?.git.commitDate)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500">
              <RefreshCw className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase">Upstream</p>
            </div>
            <p className="mt-2 text-sm font-bold text-slate-950">
              {versionInfo?.upstreamVersion
                ? `v${versionInfo.upstreamVersion}`
                : "Chưa có phiên bản upstream"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Ahead {versionInfo?.git.ahead ?? 0} · Behind{" "}
              {versionInfo?.git.behind ?? 0}
              {versionInfo?.git.dirty ? " · local dirty" : ""}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            isLoading={
              activeTask === "checkUpdate" ||
              isTaskRunning("checkUpdate", serverRunningTask)
            }
            disabled={isRunning && activeTask !== "checkUpdate"}
            onClick={() => handleRun("checkUpdate")}
          >
            Kiểm tra bản mới
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<DownloadCloud className="h-3.5 w-3.5" />}
            isLoading={
              activeTask === "fullUpdate" ||
              isTaskRunning("fullUpdate", serverRunningTask)
            }
            disabled={isRunning && activeTask !== "fullUpdate"}
            onClick={() => handleRun("fullUpdate")}
          >
            Cập nhật đầy đủ
          </Button>
        </div>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="section-title">Docker stack</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Postgres và SearXNG
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Startup scripts hiện chạy cả Postgres, SearXNG và Valkey bằng{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                docker compose --profile search up -d postgres searxng
              </code>
              .
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Stop scripts chỉ dùng{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                docker compose --profile search stop postgres searxng
                searxng-valkey
              </code>
              , không chạy <code>docker compose down</code>,{" "}
              <code>docker rm</code> hoặc xóa volumes.
            </p>
          </div>
          <Badge
            tone={
              statusQuery.data?.dockerServices.every(
                (service) => service.running,
              )
                ? "success"
                : "warning"
            }
          >
            {statusQuery.data?.dockerServices.every(
              (service) => service.running,
            )
              ? "Đang chạy"
              : "Cần kiểm tra"}
          </Badge>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {statusQuery.data?.dockerServices.map((service) => (
            <div
              key={service.key}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-950">
                  {service.label}
                </p>
                <Badge tone={service.running ? "success" : "warning"}>
                  {service.running ? "Running" : service.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {service.containerName}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="maintenance-commands" className="panel scroll-mt-6 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="section-title">Lệnh nhanh</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Bảo trì cục bộ
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Mỗi nút chạy đúng một lệnh Bun của project, chủ yếu qua{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                scripts/local-dev.ts
              </code>
              . Output được trả về sau khi chạy xong.
            </p>
          </div>
          {isRunning ? (
            <Badge tone="info">Đang chạy: {runningLabel}</Badge>
          ) : statusQuery.data?.runningTask ? (
            <Badge tone="warning">
              Tác vụ khác đang chạy: {statusQuery.data.runningTask}
            </Badge>
          ) : (
            <Badge tone="success">Sẵn sàng</Badge>
          )}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {tasks.map((task) => {
            const taskIsActive =
              activeTask === task.key ||
              isTaskRunning(task.key, serverRunningTask);
            return (
              <div
                key={task.key}
                className="flex flex-col rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
              >
                <p className="text-sm font-bold text-slate-950">{task.label}</p>
                <p className="mt-1 flex-1 text-xs text-slate-600">
                  {task.description}
                </p>
                <div className="mt-3">
                  <Button
                    variant={task.variant}
                    size="md"
                    isLoading={taskIsActive}
                    disabled={isRunning && !taskIsActive}
                    onClick={() => handleRun(task.key)}
                    className="w-full"
                  >
                    {taskIsActive ? "Đang chạy…" : task.label}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {isPending ? (
          <p className="mt-3 text-xs text-slate-500">
            Tác vụ có thể mất vài phút (đặc biệt là `bun install`). Đừng đóng
            tab này.
          </p>
        ) : null}
      </section>

      <section className="panel border-rose-200 bg-rose-50/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-rose-700 uppercase">
              Vùng nguy hiểm
            </p>
            <h3 className="mt-1 text-sm font-bold text-rose-950">
              Dừng toàn bộ process local
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-rose-800">
              Nút này dùng khi port bị kẹt hoặc cần tắt sạch local stack. Nó sẽ
              chạy <code>bun run dev:kill</code>, dừng Docker Compose bằng{" "}
              <code>stop</code> và dừng các process dev của BidTool trên máy
              hiện tại. Không xóa container, volume hoặc dữ liệu Postgres.
            </p>
          </div>
          <Badge tone="critical">Sẽ ngắt kết nối</Badge>
        </div>
      </section>

      {errorMessage ? (
        <section className="panel border-rose-200 bg-rose-50/80 p-4">
          <p className="text-sm font-bold text-rose-900">Lỗi khi chạy</p>
          <pre className="mt-2 text-xs whitespace-pre-wrap text-rose-800">
            {errorMessage}
          </pre>
        </section>
      ) : null}

      {lastResult ? (
        <section id="maintenance-results" className="panel scroll-mt-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <p className="section-title">Kết quả gần nhất</p>
              <h3 className="mt-1 text-base font-bold text-slate-950">
                {tasks.find((t) => t.key === lastResult.task)?.label}{" "}
                <span className="text-xs font-normal text-slate-500">
                  ({lastResult.command})
                </span>
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lastResult.exitCode === 0 ? (
                <Badge tone="success">Thành công · exit 0</Badge>
              ) : (
                <Badge tone="critical">Lỗi · exit {lastResult.exitCode}</Badge>
              )}
              <span className="text-xs text-slate-500">
                {formatDuration(lastResult.startedAt, lastResult.finishedAt)} ·{" "}
                {formatTime(lastResult.finishedAt)}
              </span>
            </div>
          </div>

          <pre className="mt-3 max-h-[28rem] overflow-auto rounded-lg border border-slate-200 bg-slate-950 px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-100">
            {lastResult.output.trim() || "(không có output)"}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
