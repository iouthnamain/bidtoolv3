"use client";

import Link from "next/link";

import { Badge, Button } from "~/app/_components/ui";

type WorkflowLatestRun = {
  status: "success" | "failed" | "running";
  startedAt: string;
  finishedAt: string | null;
  message: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Chưa có";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("vi-VN");
}

function runTone(
  status: WorkflowLatestRun["status"] | null,
): "success" | "critical" | "warning" | "neutral" {
  if (status === "success") {
    return "success";
  }
  if (status === "failed") {
    return "critical";
  }
  if (status === "running") {
    return "warning";
  }
  return "neutral";
}

function runLabel(status: WorkflowLatestRun["status"] | null) {
  if (status === "success") {
    return "Ổn định";
  }
  if (status === "failed") {
    return "Cần xem";
  }
  if (status === "running") {
    return "Đang chạy";
  }
  return "Chưa chạy";
}

interface WorkflowCardProps {
  id: number;
  name: string;
  triggerLabel: string;
  isActive: boolean;
  filterSummary: string[];
  latestRun: WorkflowLatestRun | null;
  runCount: number;
  isRunningNow?: boolean;
  isToggling?: boolean;
  onRunNow: () => void;
  onToggleActive: (next: boolean) => void;
}

export function WorkflowCard({
  id,
  name,
  triggerLabel,
  isActive,
  filterSummary,
  latestRun,
  runCount,
  isRunningNow = false,
  isToggling = false,
  onRunNow,
  onToggleActive,
}: WorkflowCardProps) {
  return (
    <article className="panel rounded-xl p-4 transition-colors hover:border-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm leading-tight font-semibold [overflow-wrap:anywhere] text-slate-900">
              {name}
            </p>
            <Badge tone={isActive ? "success" : "neutral"}>
              {isActive ? "Hoạt động" : "Tạm dừng"}
            </Badge>
            <Badge tone={runTone(latestRun?.status ?? null)}>
              {runLabel(latestRun?.status ?? null)}
            </Badge>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Trigger: {triggerLabel} • {runCount} lần chạy
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {filterSummary.slice(0, 3).map((chip) => (
              <span
                key={`${id}-${chip}`}
                className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        <Link
          href={`/workflows/${id}`}
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Quản lý
        </Link>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <p className="font-medium text-slate-800">Lần chạy gần nhất</p>
        <p className="mt-1">{formatDateTime(latestRun?.startedAt ?? null)}</p>
        <p className="mt-1 text-slate-500">
          {latestRun?.message ?? "Workflow chưa có lịch sử chạy."}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          isLoading={isRunningNow}
          disabled={!isActive}
          onClick={onRunNow}
        >
          Chạy ngay
        </Button>
        <Button
          variant="secondary"
          size="sm"
          isLoading={isToggling}
          onClick={() => onToggleActive(!isActive)}
        >
          {isActive ? "Tạm dừng" : "Kích hoạt"}
        </Button>
      </div>
    </article>
  );
}
