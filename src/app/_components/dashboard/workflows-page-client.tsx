"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { WorkflowCard } from "~/app/_components/dashboard/workflow-card";
import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { api } from "~/trpc/react";

type WorkflowFilter =
  | "all"
  | "active"
  | "inactive"
  | "attention"
  | "never_ran";

const filterLabels: Record<WorkflowFilter, string> = {
  all: "Tất cả",
  active: "Hoạt động",
  inactive: "Tạm dừng",
  attention: "Cần xem",
  never_ran: "Chưa chạy",
};

export function WorkflowsPageClient() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<WorkflowFilter>("all");
  const [workflows] = api.workflow.list.useSuspenseQuery();
  const [notifications] = api.notification.list.useSuspenseQuery({ limit: 5 });
  const utils = api.useUtils();

  const runNow = api.workflow.runNow.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workflow.list.invalidate(),
        utils.workflow.getRuns.invalidate(),
        utils.notification.list.invalidate(),
        utils.insight.getWorkflowHealth.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
    },
  });

  const setActive = api.workflow.setActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workflow.list.invalidate(),
        utils.workflow.getById.invalidate(),
        utils.insight.getWorkflowHealth.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
    },
  });

  const createWorkflow = api.workflow.create.useMutation({
    onSuccess: async (workflow) => {
      await utils.workflow.list.invalidate();
      if (workflow) {
        router.push(`/workflows/${workflow.id}`);
      }
    },
  });

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((workflow) => {
      if (activeFilter === "all") {
        return true;
      }

      if (activeFilter === "active") {
        return workflow.isActive;
      }

      if (activeFilter === "inactive") {
        return !workflow.isActive;
      }

      if (activeFilter === "attention") {
        return workflow.latestRun?.status === "failed";
      }

      return workflow.latestRun === null;
    });
  }, [activeFilter, workflows]);

  const counts = useMemo(
    () => ({
      all: workflows.length,
      active: workflows.filter((workflow) => workflow.isActive).length,
      inactive: workflows.filter((workflow) => !workflow.isActive).length,
      attention: workflows.filter(
        (workflow) => workflow.latestRun?.status === "failed",
      ).length,
      never_ran: workflows.filter((workflow) => workflow.latestRun === null)
        .length,
    }),
    [workflows],
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1.45fr_0.95fr]">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-bold">Danh sách workflow</h2>
            <p className="mt-1 text-xs text-slate-500">
              Tạo mới, tạm dừng, chạy thử và mở trang quản lý chi tiết cho từng
              workflow.
            </p>
          </div>

          <Button
            variant="primary"
            size="sm"
            isLoading={createWorkflow.isPending}
            onClick={() => {
              createWorkflow.mutate({
                name: `Workflow mới ${workflows.length + 1}`,
                triggerType: "new_package",
                actionType: "in_app",
                triggerConfig: {},
                actionConfig: {},
              });
            }}
          >
            {createWorkflow.isPending ? "Đang tạo..." : "Tạo workflow"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(filterLabels) as WorkflowFilter[]).map((filterKey) => (
            <button
              key={filterKey}
              type="button"
              onClick={() => setActiveFilter(filterKey)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeFilter === filterKey
                  ? "border-sky-700 bg-sky-700 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>{filterLabels[filterKey]}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                  activeFilter === filterKey
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {counts[filterKey]}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {filteredWorkflows.length === 0 ? (
            <EmptyState
              title="Không có workflow phù hợp bộ lọc"
              description="Hãy đổi bộ lọc phía trên hoặc tạo workflow mới từ trang này hay từ Smart View."
            />
          ) : (
            filteredWorkflows.map((workflow) => (
              <WorkflowCard
                key={workflow.id}
                id={workflow.id}
                name={workflow.name}
                triggerLabel={workflow.triggerType}
                isActive={workflow.isActive}
                filterSummary={workflow.triggerSummary}
                latestRun={workflow.latestRun}
                runCount={workflow.runCount}
                isRunningNow={
                  runNow.isPending &&
                  runNow.variables?.workflowId === workflow.id
                }
                isToggling={
                  setActive.isPending && setActive.variables?.id === workflow.id
                }
                onRunNow={() => runNow.mutate({ workflowId: workflow.id })}
                onToggleActive={(next) =>
                  setActive.mutate({ id: workflow.id, isActive: next })
                }
              />
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        <article className="panel p-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold">Trạng thái nhanh</h3>
            <Badge tone="info" count={workflows.length}>
              Workflow
            </Badge>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {counts.active} workflow đang hoạt động
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {counts.inactive} workflow đang tạm dừng
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {counts.attention} workflow cần xem lại
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {counts.never_ran} workflow chưa từng chạy
            </div>
          </div>
        </article>

        <article className="panel p-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold">Thông báo gần đây</h3>
            <Link
              href="/notifications"
              className="text-xs font-semibold text-sky-700 hover:underline"
            >
              Mở trung tâm thông báo
            </Link>
          </div>

          <ul className="mt-3 space-y-2 text-xs text-slate-700">
            {notifications.length === 0 ? (
              <li>
                <EmptyState
                  title="Không có thông báo"
                  description="Thông báo chạy workflow sẽ xuất hiện tại đây sau các lần chạy thành công."
                />
              </li>
            ) : (
              notifications.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2"
                >
                  <p className="leading-tight font-semibold text-slate-900">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{item.body}</p>
                </li>
              ))
            )}
          </ul>
        </article>
      </section>
    </div>
  );
}
