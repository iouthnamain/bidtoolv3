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
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-lg border border-slate-300 bg-white p-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <h2 className="font-bold text-sm">Workflows</h2>
          <button
            type="button"
            className="w-full rounded bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 text-xs font-bold transition-colors sm:w-auto"
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
            {createWorkflow.isPending ? "..." : "+"}
          </button>
        </div>

        <div className="mt-2 space-y-1.5">
          {workflows.length === 0 ? (
            <article className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-600">
              Không có workflow. ➜ Tạo mới
            </article>
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

      <section className="rounded-lg border border-slate-300 bg-white p-3 shadow-xs">
        <h3 className="font-bold text-sm pb-2 border-b border-slate-200">Thông báo gần đây</h3>
        <ul className="mt-2 space-y-1.5 text-xs text-slate-700">
          {notifications.length === 0 ? (
            <li className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-slate-500">
              Không có thông báo.
            </li>
          ) : (
            notifications.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 hover:bg-slate-100 transition-colors">
                <p className="font-semibold text-slate-900 leading-tight">{item.title}</p>
                <p className="text-slate-600 text-[10px] mt-0.5">{item.body}</p>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
