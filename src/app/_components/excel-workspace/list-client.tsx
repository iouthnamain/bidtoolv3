"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "~/trpc/react";

type WorkspaceStatus =
  | "draft"
  | "imported"
  | "mapped"
  | "reviewed"
  | "matched"
  | "exported"
  | "catalog_generated"
  | "checked"
  | "approved";
type WorkspaceStatusFilter = "all" | WorkspaceStatus;

const statusLabels: Record<WorkspaceStatus, string> = {
  draft: "Bản nháp",
  imported: "Đã nhập tệp",
  mapped: "Đã ghép cột",
  reviewed: "Đã duyệt dòng",
  matched: "Đã chọn sản phẩm",
  exported: "Đã xuất tệp",
  catalog_generated: "Đã tạo danh mục",
  checked: "Đã kiểm tra",
  approved: "Đã duyệt cuối",
};

const statusFilterOptions: Array<{
  value: WorkspaceStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "draft", label: statusLabels.draft },
  { value: "imported", label: statusLabels.imported },
  { value: "mapped", label: statusLabels.mapped },
  { value: "reviewed", label: statusLabels.reviewed },
  { value: "matched", label: statusLabels.matched },
  { value: "exported", label: statusLabels.exported },
];

function displayWorkspaceName(name: string) {
  return name === "Product sourcing workspace"
    ? "Không gian tìm nguồn sản phẩm"
    : name;
}

export function ExcelWorkspaceListClient() {
  const router = useRouter();
  const [name, setName] = useState("Không gian tìm nguồn sản phẩm");
  const [status, setStatus] = useState<WorkspaceStatusFilter>("all");
  const utils = api.useUtils();
  const { data: workspaces = [], isLoading } =
    api.excelWorkspace.listWorkspaces.useQuery({
      status: status === "all" ? undefined : status,
    });

  const createWorkspace = api.excelWorkspace.createWorkspace.useMutation({
    onSuccess: async (workspace) => {
      await utils.excelWorkspace.listWorkspaces.invalidate();
      router.push(`/excel-workspace/${workspace.id}?step=import`);
    },
  });
  const deleteWorkspace = api.excelWorkspace.deleteWorkspace.useMutation({
    onSuccess: async () => {
      await utils.excelWorkspace.listWorkspaces.invalidate();
    },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
      <section className="panel p-4">
        <div className="border-b border-slate-200 pb-3">
          <p className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase">
            Không gian mới
          </p>
          <h2 className="mt-1 text-base font-bold text-slate-950">
            Bắt đầu từ tệp Excel
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Tạo không gian làm việc, tải tệp lên, ghép cột, chọn sản phẩm khớp
            rồi xuất tệp `.xlsx` đã bổ sung dữ liệu.
          </p>
        </div>
        <div className="mt-3 grid gap-2">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tên không gian"
            aria-label="Tên không gian Excel mới"
          />
          <button
            type="button"
            className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={!name.trim() || createWorkspace.isPending}
            onClick={() => createWorkspace.mutate({ name })}
          >
            {createWorkspace.isPending ? "Đang tạo..." : "Tạo không gian"}
          </button>
        </div>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-bold">Danh sách không gian</h2>
            <p className="mt-1 text-xs text-slate-500">
              {isLoading
                ? "Đang tải..."
                : `${workspaces.length.toLocaleString("vi-VN")} không gian`}
            </p>
          </div>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={status}
            aria-label="Lọc không gian Excel theo trạng thái"
            onChange={(event) =>
              setStatus(event.target.value as WorkspaceStatusFilter)
            }
          >
            {statusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 grid gap-2">
          {workspaces.map((workspace) => (
            <article
              key={workspace.id}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/excel-workspace/${workspace.id}?step=${workspace.routeMeta.nextStep}`}
                    className="font-semibold text-slate-900 hover:text-slate-700"
                  >
                    {displayWorkspaceName(workspace.name)}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {workspace.sourceFileName ?? "Chưa có tệp"} •{" "}
                    {workspace.sourceSheetName ?? "Chưa chọn trang tính"} •{" "}
                    {workspace.routeMeta.importedItemCount.toLocaleString("vi-VN")}{" "}
                    dòng đã nhập • {statusLabels[workspace.status]}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Bước tiếp theo: {workspace.routeMeta.nextStep} • Còn mở:{" "}
                    {workspace.routeMeta.openItemCount.toLocaleString("vi-VN")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/excel-workspace/${workspace.id}?step=${workspace.routeMeta.nextStep}`}
                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-100"
                  >
                    Mở
                  </Link>
                  <button
                    type="button"
                    className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    disabled={
                      workspace.status === "exported" ||
                      workspace.status === "approved" ||
                      deleteWorkspace.isPending
                    }
                    onClick={() => deleteWorkspace.mutate({ id: workspace.id })}
                    aria-label={`Xoá ${displayWorkspaceName(workspace.name)}`}
                  >
                    Xoá
                  </button>
                </div>
              </div>
            </article>
          ))}
          {workspaces.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Chưa có không gian nào.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
