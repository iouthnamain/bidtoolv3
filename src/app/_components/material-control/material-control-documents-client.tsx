"use client";

import { api } from "~/trpc/react";

export function MaterialControlDocumentsClient({
  projectId,
}: {
  projectId: number;
}) {
  const documents = api.materialControl.listDocuments.useQuery({ projectId });
  if (documents.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">Đang tải tài liệu…</div>
    );
  if (documents.isError)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được tài liệu.
      </div>
    );
  const rows = documents.data ?? [];
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-extrabold">Tài liệu dự án</h2>
        <p className="mt-1 text-sm text-slate-600">
          Bằng chứng giao nhận, mua hàng và lắp đặt được lưu dưới workspace.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-600">Chưa có tài liệu.</p>
      ) : (
        <div className="divide-y divide-slate-200">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="font-bold">{row.originalFileName}</p>
                <p className="text-xs text-slate-600">
                  {row.category} · {row.mimeType} · {row.fileSize} bytes
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {row.checksum.slice(0, 12)}…
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
