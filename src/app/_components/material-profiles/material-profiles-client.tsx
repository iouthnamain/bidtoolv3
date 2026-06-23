"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, FileSpreadsheet, FolderOpen, Plus } from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type Workspace = RouterOutputs["materialProfile"]["list"][number];

const statusLabel: Record<Workspace["status"], string> = {
  draft: "Nháp",
  imported: "Đã import",
  mapped: "Đã map",
  reviewed: "Đã duyệt",
  matched: "Đã match",
  exported: "Đã export",
  catalog_generated: "Đã xuất catalog",
  checked: "Đã kiểm tra",
  approved: "Đã duyệt cuối",
};

function statusTone(status: Workspace["status"]) {
  if (status === "catalog_generated" || status === "exported") return "success";
  if (status === "matched" || status === "reviewed") return "info";
  if (status === "draft") return "neutral";
  return "warning";
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

export function MaterialProfilesClient() {
  const router = useRouter();
  const toast = useToast();
  const utils = api.useUtils();
  const [noticeNumber, setNoticeNumber] = useState("");
  const listQuery = api.materialProfile.list.useQuery({ limit: 50 });
  const createMutation = api.materialProfile.create.useMutation({
    onSuccess: async (workspace) => {
      await utils.materialProfile.list.invalidate();
      toast.success("Đã tạo hồ sơ vật tư.");
      router.push(`/material-profiles/${workspace.id}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const workspaces = listQuery.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="panel p-4 sm:p-5">
        <p className="section-title">Bắt đầu work</p>
        <h2 className="mt-1 text-base font-bold text-slate-950">
          Nhập Số TBMT để tạo hồ sơ
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Mã này sẽ được dùng để lưu phiên làm việc, đặt tên file Excel và
          folder Catalog khi export.
        </p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate({ noticeNumber });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
              Số TBMT
            </span>
            <input
              value={noticeNumber}
              onChange={(event) => setNoticeNumber(event.target.value)}
              placeholder="VD: IB2600190527-00"
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={!noticeNumber.trim()}
            isLoading={createMutation.isPending}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Tạo hồ sơ vật tư
          </Button>
        </form>
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <p className="section-title">Danh sách trước đó</p>
          <h2 className="mt-1 text-base font-bold text-slate-950">
            Previous work
          </h2>
        </div>

        {listQuery.isLoading ? (
          <div className="p-5 text-sm text-slate-600">Đang tải danh sách…</div>
        ) : workspaces.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Chưa có hồ sơ vật tư"
              description="Tạo work đầu tiên bằng Số TBMT để bắt đầu upload và map Excel."
              icon={<FileSpreadsheet className="h-6 w-6" aria-hidden />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Số TBMT</th>
                  <th className="px-4 py-3">File gốc</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3 text-right">Dòng</th>
                  <th className="px-4 py-3">Cập nhật</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {workspaces.map((workspace) => (
                  <tr key={workspace.id}>
                    <td className="px-4 py-3 font-bold text-slate-950">
                      {workspace.noticeNumber ?? workspace.name}
                    </td>
                    <td className="max-w-52 truncate px-4 py-3 text-slate-600">
                      {workspace.sourceFileName ?? "Chưa upload"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(workspace.status)}>
                        {statusLabel[workspace.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {workspace.rowCount.toLocaleString("vi-VN")}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(workspace.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {workspace.outputDirPath ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600"
                            title={workspace.outputDirPath}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                            Có output
                          </span>
                        ) : null}
                        <Link
                          href={`/material-profiles/${workspace.id}`}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                        >
                          Resume
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
