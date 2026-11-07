"use client";

import { api } from "~/trpc/react";

type Mode = "purchases" | "shipments" | "installation";

export function MaterialControlProjectOperationsClient({
  projectId,
  mode,
}: {
  projectId: number;
  mode: Mode;
}) {
  const purchases = api.materialControl.listPurchaseCommitments.useQuery(
    { projectId },
    { enabled: mode === "purchases" },
  );
  const shipments = api.materialControl.listShipments.useQuery(
    { projectId },
    { enabled: mode === "shipments" },
  );
  const movements = api.materialControl.listMovements.useQuery(
    { projectId, limit: 500 },
    { enabled: mode === "installation" },
  );
  if (
    (mode === "purchases" && purchases.isLoading) ||
    (mode === "shipments" && shipments.isLoading) ||
    (mode === "installation" && movements.isLoading)
  )
    return (
      <div className="panel p-6 text-sm text-slate-600">Đang tải dữ liệu…</div>
    );
  if (
    (mode === "purchases" && purchases.isError) ||
    (mode === "shipments" && shipments.isError) ||
    (mode === "installation" && movements.isError)
  )
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được dữ liệu vận hành.
      </div>
    );
  if (mode === "purchases")
    return (
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-lg font-extrabold">Mua hàng</h2>
          <p className="mt-1 text-sm text-slate-600">
            Cam kết mua không làm tăng tồn kho cho đến khi có phát sinh nhận.
          </p>
        </div>
        {(purchases.data ?? []).length === 0 ? (
          <p className="p-6 text-sm text-slate-600">Chưa có cam kết mua.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {purchases.data?.map((purchase) => (
              <div key={purchase.id} className="p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-bold">
                    {purchase.supplierName ?? "Chưa có nhà cung cấp"}
                  </p>
                  <span className="text-xs font-bold text-slate-600">
                    {purchase.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {purchase.lines.length} dòng ·{" "}
                  {purchase.externalReference ?? "Không có mã tham chiếu"}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  if (mode === "shipments")
    return (
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-lg font-extrabold">Vận chuyển</h2>
          <p className="mt-1 text-sm text-slate-600">
            Theo dõi chuyến hàng, trạng thái đang đi và nhận từng phần.
          </p>
        </div>
        {(shipments.data ?? []).length === 0 ? (
          <p className="p-6 text-sm text-slate-600">Chưa có chuyến hàng.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {shipments.data?.map((shipment) => (
              <div key={shipment.id} className="p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-bold">Chuyến hàng #{shipment.id}</p>
                  <span className="text-xs font-bold text-slate-600">
                    {shipment.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {shipment.lines.length} dòng · Đã nhận{" "}
                  {shipment.lines.reduce(
                    (sum, line) => sum + line.receivedQuantity,
                    0,
                  )}{" "}
                  /{" "}
                  {shipment.lines.reduce((sum, line) => sum + line.quantity, 0)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  const installed = (movements.data ?? []).filter(
    (movement) => movement.movementType === "installation",
  );
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-extrabold">Lắp đặt</h2>
        <p className="mt-1 text-sm text-slate-600">
          Các phát sinh tiêu thụ từ công trường hoặc khu vực vào vị trí đã lắp.
        </p>
      </div>
      {installed.length === 0 ? (
        <p className="p-6 text-sm text-slate-600">Chưa có phát sinh lắp đặt.</p>
      ) : (
        <div className="divide-y divide-slate-200">
          {installed.map((movement) => (
            <div
              key={movement.id}
              className="flex flex-wrap justify-between gap-2 p-4"
            >
              <div>
                <p className="font-bold">{movement.material.materialName}</p>
                <p className="text-sm text-slate-600">
                  {movement.material.specText} · {movement.material.unit}
                </p>
              </div>
              <span className="font-extrabold text-emerald-700">
                {movement.quantity}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
