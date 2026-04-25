"use client";

import { Button, EmptyState } from "~/app/_components/ui";
import { WorkflowCard } from "~/app/_components/dashboard/workflow-card";
import { api } from "~/trpc/react";

export function WorkflowsPageClient() {
  const [workflows] = api.workflow.list.useSuspenseQuery();
  const [notifications] = api.notification.list.useSuspenseQuery({ limit: 5 });
  const utils = api.useUtils();

  const runNow = api.workflow.runNow.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workflow.list.invalidate(),
        utils.notification.list.invalidate(),
      ]);
    },
  });

  const createWorkflow = api.workflow.create.useMutation({
    onSuccess: async () => {
      await utils.workflow.list.invalidate();
    },
  });

  return (
    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <h2 className="text-sm font-bold">Workflows</h2>
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

        <div className="mt-3 space-y-2">
          {workflows.length === 0 ? (
            <EmptyState
              title="Chưa có workflow"
              description="Tạo workflow mới để tự động hóa việc theo dõi gói thầu."
            />
          ) : (
            workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                name={wf.name}
                triggerLabel={wf.triggerType}
                isActive={wf.isActive}
                onRunNow={() => runNow.mutate({ workflowId: wf.id })}
              />
            ))
          )}
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="border-b border-slate-200 pb-2 text-sm font-bold">
          Thông báo gần đây
        </h3>
        <ul className="mt-3 space-y-1.5 text-xs text-slate-700">
          {notifications.length === 0 ? (
            <li>
              <EmptyState
                title="Không có thông báo"
                description="Hệ thống sẽ hiển thị thông báo tại đây khi workflow phát sinh sự kiện."
              />
            </li>
          ) : (
            notifications.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-slate-200 bg-slate-50/90 px-2 py-1.5 transition-colors duration-150 hover:bg-slate-100"
              >
                <p className="leading-tight font-semibold text-slate-900">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{item.body}</p>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
