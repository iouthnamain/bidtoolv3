"use client";

import { Badge, EmptyState } from "~/app/_components/ui";
import { formatDateTime } from "~/lib/datetime";
import { api } from "~/trpc/react";

type RunStatus = "success" | "failed" | "running" | null;

function toRunTone(
  status: RunStatus,
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

export function WorkflowDetailRunsClient({
  workflowId,
}: {
  workflowId: number;
}) {
  const runsQuery = api.workflow.getRuns.useQuery({ workflowId });
  const runHistory = runsQuery.data ?? [];

  return (
    <section className="panel p-4">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-sm font-bold">Lịch sử chạy</h2>
        <p className="mt-1 text-xs text-slate-500">
          Theo dõi thông điệp, thời gian bắt đầu và kết quả cho từng lần chạy.
        </p>
      </div>

      {runsQuery.isLoading ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          Đang tải lịch sử chạy…
        </div>
      ) : runHistory.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="Chưa có lịch sử chạy"
          description="Bấm Chạy ngay để tạo lần chạy đầu tiên và theo dõi log tại đây."
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {runHistory.map((run) => (
            <li
              key={run.id}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toRunTone(run.status)}>{run.status}</Badge>
                  <span className="text-sm font-semibold text-slate-900">
                    {formatDateTime(run.startedAt)}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Kết thúc: {formatDateTime(run.finishedAt)}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{run.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
