"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export function MaterialControlPlanCreateForm({
  projectId,
}: {
  projectId: number;
}) {
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const create = api.materialControl.createPlan.useMutation({
    onSuccess: async (plan) => {
      setName("");
      const includesProject = (filter: number | undefined) =>
        filter === undefined || filter === plan.projectId;
      await Promise.all([
        utils.materialControl.listPlanDetails.invalidate(undefined, {
          predicate: ({ queryKey: [, options] }) => {
            const input = options?.input;
            return (
              includesProject(input?.projectId) &&
              (input?.status === undefined || input.status === plan.status)
            );
          },
        }),
        utils.materialControl.dashboardSummary.invalidate(undefined, {
          predicate: ({ queryKey: [, options] }) =>
            includesProject(options?.input?.projectId),
        }),
      ]);
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ projectId, name });
      }}
    >
      <div className="min-w-60 flex-1">
        <label
          htmlFor="new-plan-name"
          className="text-xs font-bold text-slate-700"
        >
          Tên kế hoạch mới
        </label>
        <input
          id="new-plan-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="mt-1 min-h-10 w-full rounded border border-slate-500 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={create.isPending}
        className="min-h-10 rounded bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
      >
        {create.isPending ? "Đang tạo…" : "Thêm kế hoạch"}
      </button>
      {create.error ? (
        <p role="alert" className="basis-full text-sm text-rose-700">
          {create.error.message}
        </p>
      ) : null}
    </form>
  );
}
