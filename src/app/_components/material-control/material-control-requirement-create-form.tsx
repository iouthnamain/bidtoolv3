"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export function MaterialControlRequirementCreateForm({
  planId,
}: {
  planId: number;
}) {
  const utils = api.useUtils();
  const [materialName, setMaterialName] = useState("");
  const [specText, setSpecText] = useState("");
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("1");
  const create = api.materialControl.createRequirement.useMutation({
    onSuccess: async (requirement) => {
      setMaterialName("");
      setSpecText("");
      setUnit("");
      setAmount("1");
      const savedPlan = { planId: requirement.planId };
      const projectId =
        utils.materialControl.getPlanDetail.getData(savedPlan)?.plan.projectId;
      const includesProject = (filter: number | undefined) =>
        projectId === undefined || filter === undefined || filter === projectId;
      await Promise.all([
        utils.materialControl.getPlanDetail.invalidate(savedPlan),
        utils.materialControl.listPlanDetails.invalidate(undefined, {
          predicate: ({ queryKey: [, options] }) =>
            includesProject(options?.input?.projectId),
        }),
        utils.materialControl.dashboardSummary.invalidate(undefined, {
          predicate: ({ queryKey: [, options] }) =>
            includesProject(options?.input?.projectId),
        }),
        utils.materialControl.listShortages.invalidate(undefined, {
          predicate: ({ queryKey: [, options] }) =>
            includesProject(options?.input?.projectId) &&
            (!options?.input?.lateOnly || requirement.requiredAt !== null),
        }),
      ]);
    },
  });
  return (
    <form
      className="space-y-3 border-b border-slate-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({
          planId,
          materialName,
          specText,
          unit,
          quantity: Number(amount),
        });
      }}
    >
      <h3 className="font-extrabold">Thêm nhu cầu</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          aria-label="Tên vật tư"
          placeholder="Tên vật tư"
          value={materialName}
          onChange={(event) => setMaterialName(event.target.value)}
          required
          className="min-h-10 rounded border border-slate-500 px-3 py-2 text-sm"
        />
        <input
          aria-label="Quy cách"
          placeholder="Quy cách / thông số"
          value={specText}
          onChange={(event) => setSpecText(event.target.value)}
          required
          className="min-h-10 rounded border border-slate-500 px-3 py-2 text-sm"
        />
        <input
          aria-label="Đơn vị"
          placeholder="Đơn vị (m, kg…)"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          required
          className="min-h-10 rounded border border-slate-500 px-3 py-2 text-sm"
        />
        <input
          aria-label="Số lượng"
          type="number"
          min="0.001"
          step="0.001"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
          className="min-h-10 rounded border border-slate-500 px-3 py-2 text-sm"
        />
      </div>
      {create.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {create.error.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={create.isPending}
        className="min-h-10 rounded bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
      >
        {create.isPending ? "Đang lưu…" : "Lưu nhu cầu"}
      </button>
    </form>
  );
}
