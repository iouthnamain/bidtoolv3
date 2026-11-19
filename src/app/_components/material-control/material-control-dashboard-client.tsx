"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

const numberFormat = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 3,
});

const flowMetrics = [
  ["ordered", "Đã đặt mua"],
  ["shipped", "Đã gửi"],
  ["received", "Đã nhận"],
  ["inTransit", "Đang vận chuyển"],
  ["installed", "Đã lắp"],
] as const;

function Metric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  tone?: "slate" | "blue" | "amber" | "rose";
}) {
  const tones = {
    slate: "border-slate-300 bg-white",
    blue: "border-blue-200 bg-blue-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
  } as const;
  return (
    <article className={`rounded border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">
        {label}
      </p>
      <p className="mt-2 text-2xl font-extrabold text-slate-950">
        {typeof value === "number" ? numberFormat.format(value) : value}
      </p>
    </article>
  );
}

export function MaterialControlDashboardClient() {
  const summary = api.materialControl.dashboardSummary.useQuery(undefined, {
    staleTime: 15_000,
  });

  if (summary.isLoading) {
    return (
      <div className="panel p-6 text-sm text-slate-600">
        Đang tải tổng quan vật tư…
      </div>
    );
  }
  if (summary.isError) {
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được tổng quan vật tư. Vui lòng thử lại.
      </div>
    );
  }
  const data = summary.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Dự án"
          value={`${numberFormat.format(data.projects.active)} / ${numberFormat.format(data.projects.total)} đang hoạt động`}
          tone="blue"
        />
        <Metric label="Nhu cầu" value={data.requirements.total} />
        <Metric
          label="Nhu cầu cần mua thêm"
          value={data.shortages.count}
          tone="amber"
        />
        <Metric
          label="Nhu cầu quá hạn"
          value={data.shortages.late}
          tone="rose"
        />
      </div>

      <section aria-labelledby="material-flow-heading" className="panel p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            id="material-flow-heading"
            className="text-lg font-extrabold text-slate-950"
          >
            Tiến độ theo vật tư
          </h2>
          <Link
            href="/material-control/projects"
            className="rounded border border-slate-500 px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            Mở danh sách dự án
          </Link>
        </div>
        {data.materialFlow.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            Chưa có phát sinh mua hàng, vận chuyển hoặc lắp đặt.
          </p>
        ) : (
          <ul role="list" className="mt-3 divide-y divide-slate-200">
            {data.materialFlow.map((row) => (
              <li
                key={JSON.stringify(row.material)}
                className="grid gap-3 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,5fr)]"
              >
                <div className="min-w-0 wrap-break-word">
                  <h3 className="font-bold">{row.material.materialName}</h3>
                  <p className="text-sm text-slate-600">
                    {row.material.specText} · Đơn vị {row.material.unit}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {flowMetrics.map(([field, label]) => (
                    <div key={field}>
                      <dt className="text-xs text-slate-600">{label}</dt>
                      <dd className="text-lg font-bold tabular-nums">
                        {numberFormat.format(row[field])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link
          href="/material-control/stock"
          className="panel p-4 transition hover:border-blue-400"
        >
          <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">
            Loại vật tư còn khả dụng
          </p>
          <p className="mt-2 text-2xl font-extrabold">
            {numberFormat.format(data.stock.availableMaterialCount)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Xem tồn kho theo vật tư và địa điểm
          </p>
        </Link>
        <Link
          href="/material-control/shortages"
          className="panel p-4 transition hover:border-rose-400"
        >
          <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">
            Nhu cầu cần xử lý
          </p>
          <p className="mt-2 text-2xl font-extrabold text-rose-700">
            {numberFormat.format(data.shortages.needsAttention)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Mở danh sách thiếu và quá hạn
          </p>
        </Link>
        <Link
          href="/material-control/locations"
          className="panel p-4 transition hover:border-amber-400"
        >
          <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">
            Kho & địa điểm
          </p>
          <p className="mt-2 text-2xl font-extrabold">
            {numberFormat.format(data.stock.locationCount)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Tổ chức tồn kho dùng chung cho nhiều dự án
          </p>
        </Link>
      </section>
    </div>
  );
}
