"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { PermissionGate } from "~/app/_components/dashboard/permission-gate";
import { WorkflowCard } from "~/app/_components/dashboard/workflow-card";
import { Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api } from "~/trpc/react";

type WorkflowFilter = "all" | "active" | "inactive" | "attention" | "never_ran";

const filterLabels: Record<WorkflowFilter, string> = {
  all: "Tất cả",
  active: "Hoạt động",
  inactive: "Tạm dừng",
  attention: "Cần xem",
  never_ran: "Chưa chạy",
};

export function WorkflowsListClient() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<WorkflowFilter>("all");
  const [workflows] = api.workflow.list.useSuspenseQuery();
  const utils = api.useUtils();
  const toast = useToast();

  const runNow = api.workflow.runNow.useMutation({
    onSuccess: async () => {
      toast.success("Đã chạy workflow.");
      await Promise.all([
        utils.workflow.list.invalidate(),
        utils.workflow.getRuns.invalidate(),
        utils.notification.unreadCount.invalidate(),
        utils.notification.list.invalidate(),
      ]);
    },
    onError: () => {
      toast.error("Không thể chạy workflow.");
    },
  });

  const setActive = api.workflow.setActive.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.isActive ? "Đã kích hoạt workflow." : "Đã tạm dừng workflow.",
      );
      await Promise.all([
        utils.workflow.list.invalidate(),
        utils.workflow.getById.invalidate(),
      ]);
    },
    onError: () => {
      toast.error("Không thể thay đổi trạng thái workflow.");
    },
  });

  const createWorkflow = api.workflow.create.useMutation({
    onSuccess: async (workflow) => {
      toast.success("Đã tạo workflow mới.");
      await utils.workflow.list.invalidate();
      if (workflow) {
        router.push(`/workflows/${workflow.id}`);
      }
    },
    onError: () => {
      toast.error("Không thể tạo workflow.");
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
    <div className="animate-rise">
    <section className="panel-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-bold">Danh sách workflow</h2>
          <span className="text-2xl font-extrabold stat-value text-slate-900">{workflows.length}</span>
          <span className="text-xs text-slate-500 ml-1">workflow</span>
        </div>

        <PermissionGate permission="workflow:write">
          <Button
            variant="primary"
            size="sm"
            isLoading={createWorkflow.isPending}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              createWorkflow.mutate({
                name: `Workflow mới ${workflows.length + 1}`,
                triggerType: "new_search_result",
                actionType: "in_app",
                triggerConfig: {},
                actionConfig: {},
              });
            }}
          >
            {createWorkflow.isPending ? "Đang tạo…" : "Tạo workflow"}
          </Button>
        </PermissionGate>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(filterLabels) as WorkflowFilter[]).map((filterKey) => (
          <button
            key={filterKey}
            type="button"
            onClick={() => setActiveFilter(filterKey)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-8 ${
              activeFilter === filterKey
                ? "border-transparent text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            style={activeFilter === filterKey ? { background: 'linear-gradient(135deg, #0e7490, #0369a1)' } : undefined}
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
    </div>
  );
}
