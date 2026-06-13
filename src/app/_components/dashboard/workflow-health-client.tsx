"use client";

import { useMemo } from "react";

import { Badge } from "~/app/_components/ui";
import { api } from "~/trpc/react";

export function WorkflowHealthClient() {
  const [workflows] = api.workflow.list.useSuspenseQuery();

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
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <h2 className="text-sm font-bold">Trạng thái workflow</h2>
        <Badge tone="info" count={workflows.length}>
          Workflow
        </Badge>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Tổng quan nhanh về workflow đang hoạt động, tạm dừng và cần xem lại.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
    </section>
  );
}
