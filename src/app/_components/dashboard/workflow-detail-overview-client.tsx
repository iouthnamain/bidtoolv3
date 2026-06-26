"use client";

import Link from "next/link";

import { Badge, Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { formatDateTime } from "~/lib/datetime";
import { normalizeWorkflowFilterConfig } from "~/lib/workflow-config";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkflowDetail = NonNullable<RouterOutputs["workflow"]["getById"]>;
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

export function WorkflowDetailOverviewClient({
  workflowId,
  initialWorkflow,
}: {
  workflowId: number;
  initialWorkflow: WorkflowDetail;
}) {
  const workflowQuery = api.workflow.getById.useQuery(
    { id: workflowId },
    { initialData: initialWorkflow },
  );
  const utils = api.useUtils();
  const toast = useToast();
  const workflow = workflowQuery.data;

  const toggleWorkflow = api.workflow.setActive.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.isActive ? "Đã kích hoạt workflow." : "Đã tạm dừng workflow.",
      );
      await Promise.all([
        utils.workflow.getById.invalidate({ id: workflowId }),
        utils.workflow.list.invalidate(),
      ]);
    },
    onError: () => {
      toast.error("Không thể thay đổi trạng thái workflow.");
    },
  });

  const runNow = api.workflow.runNow.useMutation({
    onSuccess: async () => {
      toast.success("Đã chạy workflow.");
      await Promise.all([
        utils.workflow.getById.invalidate({ id: workflowId }),
        utils.workflow.getRuns.invalidate({ workflowId }),
        utils.workflow.list.invalidate(),
        utils.notification.unreadCount.invalidate(),
        utils.notification.list.invalidate(),
      ]);
    },
    onError: () => {
      toast.error("Không thể chạy workflow.");
    },
  });

  if (!workflow) {
    return null;
  }

  const latestRun = workflow.latestRun;
  const filterConfig = normalizeWorkflowFilterConfig(workflow.triggerConfig);

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div>
          <Link
            href="/workflows"
            className="inline-flex min-h-10 items-center rounded text-xs font-semibold text-slate-700 transition-colors duration-0 hover:text-slate-950 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Quay lại danh sách workflow
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-slate-950">
              {workflow.name}
            </h2>
            <Badge tone={workflow.isActive ? "success" : "neutral"}>
              {workflow.isActive ? "Hoạt động" : "Tạm dừng"}
            </Badge>
            <Badge tone={toRunTone(latestRun?.status ?? null)}>
              {latestRun?.status === "success"
                ? "Lần gần nhất thành công"
                : latestRun?.status === "failed"
                  ? "Lần gần nhất thất bại"
                  : latestRun?.status === "running"
                    ? "Đang chạy"
                    : "Chưa chạy"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-700">
            Trigger: {workflow.triggerType} • {workflow.runCount} lần chạy
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            isLoading={toggleWorkflow.isPending}
            onClick={() =>
              toggleWorkflow.mutate({
                id: workflow.id,
                isActive: !workflow.isActive,
              })
            }
          >
            {workflow.isActive ? "Tạm dừng ngay" : "Kích hoạt ngay"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            isLoading={runNow.isPending}
            disabled={!workflow.isActive}
            onClick={() => runNow.mutate({ workflowId })}
          >
            Chạy ngay
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-1 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded border border-slate-400 bg-slate-50 p-4">
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-700 uppercase">
            Cấu hình hiện tại
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {workflow.triggerSummary.map((item) => (
              <span
                key={item}
                className="rounded-full border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-0.5 text-xs text-slate-600"
              >
                {item}
              </span>
            ))}
          </div>
          {filterConfig.savedFilterName ? (
            <p className="mt-3 text-xs text-slate-700">
              Tạo từ bộ lọc thông minh: {filterConfig.savedFilterName}
            </p>
          ) : null}
        </div>

        <div className="rounded border border-slate-400 bg-slate-50 p-4">
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-700 uppercase">
            Lần chạy gần nhất
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            {formatDateTime(latestRun?.startedAt ?? null)}
          </p>
          <p className="mt-1 text-xs text-slate-700">
            {latestRun?.message ?? "Workflow chưa có lịch sử chạy."}
          </p>
        </div>
      </div>
    </section>
  );
}
