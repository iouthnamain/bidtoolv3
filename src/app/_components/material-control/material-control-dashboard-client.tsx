"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

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
      <p className="mt-2 text-2xl font-extrabold text-slate-950">{value}</p>
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
          value={`${data.projects.active} / ${data.projects.total} đang hoạt động`}
          tone="blue"
        />
        <Metric label="Nhu cầu" value={data.requirements.total} />
        <Metric
          label="Thiếu cần mua"
          value={data.requirements.missingToBuy}
          tone="amber"
        />
        <Metric
          label="Thiếu & chậm"
          value={`${data.shortages.count} / ${data.shortages.late}`}
          tone="rose"
        />
      </div>

      <section className="panel p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-950">
              Dòng vật tư
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Số liệu tổng hợp từ nhu cầu và sổ phát sinh bất biến.
            </p>
          </div>
          <Link
            href="/material-control/projects"
            className="rounded border border-slate-500 px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            Mở danh sách dự án
          </Link>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-xs text-slate-600">Đã đặt</dt>
            <dd className="text-lg font-bold">
              {data.requirements.requiredQuantity -
                data.requirements.missingToBuy}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Đã vận chuyển</dt>
            <dd className="text-lg font-bold">{data.logistics.shipped}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Đã nhận</dt>
            <dd className="text-lg font-bold">{data.logistics.received}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Đang đi</dt>
            <dd className="text-lg font-bold">{data.logistics.inTransit}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Đã lắp</dt>
            <dd className="text-lg font-bold">{data.logistics.installed}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link
          href="/material-control/stock"
          className="panel p-4 transition hover:border-blue-400"
        >
          <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">
            Tồn khả dụng
          </p>
          <p className="mt-2 text-2xl font-extrabold">{data.stock.available}</p>
          <p className="mt-1 text-sm text-slate-600">
            {data.stock.materialCount} loại vật tư tại{" "}
            {data.stock.locationCount} địa điểm
          </p>
        </Link>
        <Link
          href="/material-control/shortages"
          className="panel p-4 transition hover:border-rose-400"
        >
          <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">
            Cần xử lý
          </p>
          <p className="mt-2 text-2xl font-extrabold text-rose-700">
            {data.shortages.count + data.shortages.late}
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
            {data.stock.locationCount}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Tổ chức tồn kho dùng chung cho nhiều dự án
          </p>
        </Link>
      </section>
    </div>
  );
}
