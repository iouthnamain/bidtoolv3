"use client";

import { api } from "~/trpc/react";

export function MaterialControlStockClient() {
  const stock = api.materialControl.listStockBalances.useQuery(undefined, {
    staleTime: 15_000,
  });
  if (stock.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">Đang tải tồn kho…</div>
    );
  if (stock.isError)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được tồn kho.
      </div>
    );
  const rows = stock.data ?? [];
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-extrabold">Tồn theo địa điểm</h2>
        <p className="mt-1 text-sm text-slate-600">
          Khả dụng = tồn thực tế − phần đang giữ chỗ.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-600">Chưa có phát sinh tồn kho.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-600 uppercase">
              <tr>
                <th className="px-4 py-3">Vật tư</th>
                <th className="px-4 py-3">Địa điểm</th>
                <th className="px-4 py-3">Tồn</th>
                <th className="px-4 py-3">Đã giữ</th>
                <th className="px-4 py-3">Khả dụng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => (
                <tr
                  key={`${row.locationId}-${row.material.materialId ?? row.material.materialName}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-bold">{row.material.materialName}</p>
                    <p className="text-xs text-slate-600">
                      {row.material.specText} · {row.material.unit}
                    </p>
                  </td>
                  <td className="px-4 py-3">#{row.locationId}</td>
                  <td className="px-4 py-3">{row.onHand}</td>
                  <td className="px-4 py-3">{row.reserved}</td>
                  <td
                    className={`px-4 py-3 font-bold ${row.oversubscribed ? "text-rose-700" : "text-emerald-700"}`}
                  >
                    {row.available}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
