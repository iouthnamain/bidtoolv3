"use client";

import Link from "next/link";
import { PauseCircle, Play, Settings, ToggleRight } from "lucide-react";

import { PermissionGate } from "~/app/_components/dashboard/permission-gate";
import { Badge, Button } from "~/app/_components/ui";
import { formatDateTime } from "~/lib/datetime";

type WorkflowLatestRun = {
  status: "success" | "failed" | "running";
  startedAt: string;
  finishedAt: string | null;
  message: string;
};

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

function formatTriggerLabel(triggerLabel: string) {
  if (triggerLabel === "new_search_result") {
    return "Kết quả tìm kiếm mới";
  }

  if (triggerLabel === "new_package") {
    return "Gói thầu mới";
  }

  if (triggerLabel === "schedule") {
    return "Theo lịch";
  }

  return triggerLabel;
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
  const statusDotColor = (() => {
    if (isActive && latestRun?.status === "success") return "bg-emerald-500";
    if (latestRun?.status === "failed") return "bg-rose-500";
    if (latestRun?.status === "running") return "bg-amber-500";
    return "bg-slate-300";
  })();

  return (
    <article
      className={`rounded border border-slate-400/80 bg-white shadow-[var(--shadow-flat)]  transition-shadow duration-0 p-4 ${
        isActive ? "border-l-2 border-l-emerald-500" : "border-l-2 border-l-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusDotColor}`} />
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

          <p className="mt-1 text-xs text-slate-700">
            {formatTriggerLabel(triggerLabel)} • <span className="font-extrabold stat-value text-slate-900">{runCount}</span> lần chạy
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {filterSummary.slice(0, 3).map((chip) => (
              <span
                key={`${id}-${chip}`}
                className="rounded-full border border-slate-400 bg-white px-2 py-0.5 text-xs text-slate-600"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        <Link
          href={`/workflows/${id}`}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded border border-slate-400 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
          Quản lý
        </Link>
      </div>

      <div className="mt-3 rounded border border-slate-400 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <p className="font-medium text-slate-800">Lần chạy gần nhất</p>
        <p className="mt-1">{formatDateTime(latestRun?.startedAt ?? null)}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <PermissionGate permission="workflow:write">
          <Button
            variant="primary"
            size="sm"
            isLoading={isRunningNow}
            disabled={!isActive}
            leftIcon={<Play className="h-3.5 w-3.5" />}
            onClick={onRunNow}
          >
            Chạy ngay
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isLoading={isToggling}
            leftIcon={
              isActive ? (
                <PauseCircle className="h-3.5 w-3.5" />
              ) : (
                <ToggleRight className="h-3.5 w-3.5" />
              )
            }
            onClick={() => onToggleActive(!isActive)}
          >
            {isActive ? "Tạm dừng" : "Kích hoạt"}
          </Button>
        </PermissionGate>
      </div>
    </article>
  );
}
