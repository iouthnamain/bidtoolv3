"use client";

import Link from "next/link";

import { api } from "~/trpc/react";
import { MaterialControlPlanCreateForm } from "./material-control-plan-create-form";

export function MaterialControlProjectClient({
  projectId,
}: {
  projectId: number;
}) {
  const project = api.materialControl.getProject.useQuery({ id: projectId });
  const plans = api.materialControl.listPlanDetails.useQuery({ projectId });
  const documents = api.materialControl.listDocuments.useQuery({ projectId });
  if (project.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">
        Đang tải workspace…
      </div>
    );
  if (project.isError || !project.data)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tìm thấy workspace dự án.
      </div>
    );
  const row = project.data;
  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-600">
              {row.code ?? "Dự án vật tư"}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-950">
              {row.name}
            </h2>
          </div>
          <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-bold">
            {row.status}
          </span>
        </div>
        {row.description ? (
          <p className="mt-3 max-w-3xl text-sm text-slate-700">
            {row.description}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            className="rounded border border-slate-500 px-3 py-2 text-sm font-bold"
            href={`/material-control/projects/${projectId}/requirements`}
          >
            Nhu cầu
          </Link>
          <Link
            className="rounded border border-slate-500 px-3 py-2 text-sm font-bold"
            href={`/material-control/projects/${projectId}/documents`}
          >
            Tài liệu ({documents.data?.length ?? 0})
          </Link>
        </div>
      </section>
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <h3 className="font-extrabold">Kế hoạch vật tư</h3>
        </div>
        <MaterialControlPlanCreateForm projectId={projectId} />
        {plans.isLoading ? (
          <p className="p-4 text-sm text-slate-600">Đang tải kế hoạch…</p>
        ) : plans.data?.length ? (
          <div className="divide-y divide-slate-200">
            {plans.data.map((item) => (
              <Link
                key={item.plan.id}
                href={`/material-control/plans/${item.plan.id}`}
                className="block p-4 transition hover:bg-slate-50"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-bold">{item.plan.name}</p>
                  <span className="text-xs font-bold text-slate-600">
                    {item.plan.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {item.requirements.length} nhu cầu · Cần mua thêm{" "}
                  {item.totals.missingToBuy}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="p-4 text-sm text-slate-600">Chưa có kế hoạch vật tư.</p>
        )}
      </section>
    </div>
  );
}
