"use client";

import { api } from "~/trpc/react";
import { MaterialControlRequirementCreateForm } from "./material-control-requirement-create-form";

export function MaterialControlPlanClient({ planId }: { planId: number }) {
  const plan = api.materialControl.getPlanDetail.useQuery({ planId });
  if (plan.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">Đang tải kế hoạch…</div>
    );
  if (plan.isError || !plan.data)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tìm thấy kế hoạch.
      </div>
    );
  const data = plan.data;
  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <p className="text-sm text-slate-600">{data.plan.status}</p>
        <h2 className="mt-1 text-2xl font-extrabold">{data.plan.name}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {data.requirements.length} nhu cầu · Cần mua thêm{" "}
          {data.totals.missingToBuy} · Quá hạn {data.totals.lateRequirements}
        </p>
      </section>
      <section className="panel overflow-hidden">
        <MaterialControlRequirementCreateForm planId={planId} />
        <div className="border-b border-slate-200 p-4">
          <h3 className="font-extrabold">Danh sách nhu cầu</h3>
        </div>
        {data.requirements.length === 0 ? (
          <p className="p-4 text-sm text-slate-600">Chưa có nhu cầu.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {data.requirements.map((row) => (
              <div key={row.id} className="p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="font-bold">{row.materialName}</p>
                    <p className="text-sm text-slate-600">
                      {row.specText} · {row.unit}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-slate-600">
                    {row.status}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
                  <div>
                    <dt className="text-xs text-slate-600">Cần</dt>
                    <dd className="font-bold">{row.summary.required}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-600">Đặt</dt>
                    <dd className="font-bold">{row.summary.ordered}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-600">Thiếu mua</dt>
                    <dd className="font-bold text-amber-700">
                      {row.summary.missingToBuy}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-600">Đang đi</dt>
                    <dd className="font-bold">{row.summary.inTransit}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-600">Đã nhận</dt>
                    <dd className="font-bold">{row.summary.received}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-600">Còn lắp</dt>
                    <dd className="font-bold">
                      {row.summary.remainingToInstall}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
