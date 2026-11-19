"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

export function MaterialControlRequirementsClient({
  projectId,
}: {
  projectId: number;
}) {
  const plans = api.materialControl.listPlanDetails.useQuery({ projectId });
  if (plans.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">Đang tải nhu cầu…</div>
    );
  if (plans.isError)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được nhu cầu.
      </div>
    );
  const rows = (plans.data ?? []).flatMap((plan) =>
    plan.requirements.map((requirement) => ({ plan, requirement })),
  );
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-extrabold">Nhu cầu vật tư</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tách rõ cần mua, đã vận chuyển, đã nhận và còn phải lắp.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-600">Chưa có nhu cầu vật tư.</p>
      ) : (
        <div className="divide-y divide-slate-200">
          {rows.map(({ plan, requirement }) => (
            <Link
              key={requirement.id}
              href={`/material-control/plans/${plan.plan.id}`}
              className="block p-4 transition hover:bg-slate-50"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-bold">{requirement.materialName}</p>
                  <p className="text-sm text-slate-600">
                    {requirement.specText} · {requirement.unit} · Kế hoạch{" "}
                    {plan.plan.name}
                  </p>
                </div>
                <span className="rounded-full border border-slate-300 px-2 py-1 text-xs font-bold">
                  {requirement.status}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <div>
                  <dt className="text-xs text-slate-600">Cần</dt>
                  <dd className="font-bold">{requirement.summary.required}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-600">Đặt</dt>
                  <dd className="font-bold">{requirement.summary.ordered}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-600">Đã nhận</dt>
                  <dd className="font-bold">{requirement.summary.received}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-600">Đã lắp</dt>
                  <dd className="font-bold">{requirement.summary.installed}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-600">Còn thiếu</dt>
                  <dd className="font-bold text-amber-700">
                    {requirement.summary.missingToBuy}
                  </dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
