"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

export function MaterialControlShortagesClient() {
  const shortages = api.materialControl.listShortages.useQuery(undefined, {
    staleTime: 15_000,
  });
  if (shortages.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">
        Đang tải thiếu và chậm…
      </div>
    );
  if (shortages.isError)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được danh sách thiếu.
      </div>
    );
  const rows = shortages.data ?? [];
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-extrabold">Thiếu & chậm</h2>
        <p className="mt-1 text-sm text-slate-600">
          Mỗi dòng giữ nguyên tên, quy cách và đơn vị tại thời điểm lập nhu cầu.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-emerald-700">
          Không có nhu cầu thiếu hoặc quá hạn.
        </p>
      ) : (
        <div className="divide-y divide-slate-200">
          {rows.map((row) => (
            <div key={row.requirement.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{row.requirement.materialName}</p>
                  <p className="text-sm text-slate-600">
                    {row.requirement.specText} · {row.requirement.unit}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-rose-700">
                    Thiếu {row.shortage}
                  </p>
                  {row.late ? (
                    <p className="text-xs font-bold text-amber-700">Quá hạn</p>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-700">
                Cần {row.requirement.quantity} · Đã đặt{" "}
                {row.requirement.summary.ordered} · Đã nhận{" "}
                {row.requirement.summary.received}
              </p>
              <Link
                className="mt-2 inline-block text-sm font-bold text-blue-700 underline"
                href={`/material-control/plans/${row.requirement.planId}`}
              >
                Mở kế hoạch
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
