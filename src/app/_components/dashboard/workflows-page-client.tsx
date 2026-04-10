"use client";

import { api } from "~/trpc/react";
import { WorkflowCard } from "~/app/_components/dashboard/workflow-card";

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
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Danh sách workflow</h2>
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            onClick={() => {
              createWorkflow.mutate({
                name: `Workflow mới ${workflows.length + 1}`,
                triggerType: "new_package",
                actionType: "in_app",
                triggerConfig: {},
                actionConfig: {},
              });
            }}
            disabled={createWorkflow.isPending}
          >
            {createWorkflow.isPending ? "Đang tạo..." : "Tạo workflow"}
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          {workflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              name={wf.name}
              triggerLabel={wf.triggerType}
              isActive={wf.isActive}
              onRunNow={() => runNow.mutate({ workflowId: wf.id })}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Thông báo gần đây</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {notifications.map((item) => (
            <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="font-medium text-slate-900">{item.title}</p>
              <p className="text-slate-600">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
