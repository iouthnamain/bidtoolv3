"use client";

import { api } from "~/trpc/react";

export function MaterialControlLocationsClient() {
  const locations = api.materialControl.listLocations.useQuery({
    projectId: null,
    parentId: null,
  });
  if (locations.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">Đang tải địa điểm…</div>
    );
  if (locations.isError)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được địa điểm.
      </div>
    );
  const rows = locations.data ?? [];
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-extrabold">Địa điểm dùng chung</h2>
        <p className="mt-1 text-sm text-slate-600">
          Kho dùng chung có thể cấp phát cho nhiều workspace dự án.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-600">
          Chưa có địa điểm dùng chung.
        </p>
      ) : (
        <div className="divide-y divide-slate-200">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="font-bold">{row.name}</p>
                <p className="text-sm text-slate-600">
                  {row.code} · {row.type}
                </p>
              </div>
              {row.isVirtual ? (
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold">
                  Ảo
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
