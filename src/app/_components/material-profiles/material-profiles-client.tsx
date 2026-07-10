"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  SkeletonCard,
  SkeletonTable,
  buttonBaseClass,
  buttonSizeClass,
  buttonVariantClass,
} from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type Workspace = RouterOutputs["materialProfile"]["list"][number];

const statusLabel: Record<Workspace["status"], string> = {
  draft: "Nháp",
  imported: "Đã nhập",
  mapped: "Đã ánh xạ",
  reviewed: "Đã rà soát",
  matched: "Đã đối chiếu",
  exported: "Đã xuất file",
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
  const [profileName, setProfileName] = useState("");
  const [noticeNumber, setNoticeNumber] = useState("");
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<number | null>(
    null,
  );
  const [editProfileName, setEditProfileName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const mobileEditInputRef = useRef<HTMLInputElement>(null);
  const desktopEditInputRef = useRef<HTMLInputElement>(null);
  const listQuery = api.materialProfile.list.useQuery({ limit: 50 });
  const createMutation = api.materialProfile.create.useMutation({
    onSuccess: async (workspace) => {
      setProfileName("");
      setNoticeNumber("");
      await utils.materialProfile.list.invalidate();
      toast.success("Đã tạo hồ sơ. Hãy tải sheet vật tư để bắt đầu.");
      router.push(`/material-profiles/${workspace.id}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const updateMutation = api.materialProfile.update.useMutation({
    onSuccess: async () => {
      setEditingWorkspaceId(null);
      setEditProfileName("");
      await utils.materialProfile.list.invalidate();
      toast.success("Đã cập nhật hồ sơ.");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteMutation = api.materialProfile.delete.useMutation({
    onSuccess: async () => {
      setDeleteTarget(null);
      await utils.materialProfile.list.invalidate();
      toast.success("Đã xóa hồ sơ.");
    },
    onError: (error) => toast.error(error.message),
  });

  const workspaces = listQuery.data ?? [];
  const editingWorkspace = workspaces.find(
    (workspace) => workspace.id === editingWorkspaceId,
  );

  useEffect(() => {
    if (editingWorkspaceId === null) return;
    const visibleMobileInput =
      mobileEditInputRef.current?.offsetParent !== null
        ? mobileEditInputRef.current
        : null;
    (visibleMobileInput ?? desktopEditInputRef.current)?.focus();
  }, [editingWorkspaceId]);

  const startEditing = (workspace: Workspace) => {
    if (updateMutation.isPending) return;
    setEditingWorkspaceId(workspace.id);
    setEditProfileName(workspace.name ?? "");
  };

  const cancelEditing = () => {
    setEditingWorkspaceId(null);
    setEditProfileName("");
  };

  const submitWorkspaceUpdate = () => {
    const nextName = editProfileName.trim();
    if (!editingWorkspace || updateMutation.isPending) return;
    if (!nextName) return;
    if (nextName === (editingWorkspace.name ?? "").trim()) {
      cancelEditing();
      return;
    }
    updateMutation.mutate({
      workspaceId: editingWorkspace.id,
      name: nextName,
    });
  };

  const renderEditInput = (workspace: Workspace, mobile = false) =>
    editingWorkspaceId === workspace.id ? (
      <input
        ref={mobile ? mobileEditInputRef : desktopEditInputRef}
        aria-label="Tên hồ sơ"
        disabled={updateMutation.isPending}
        value={editProfileName}
        onChange={(event) => setEditProfileName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitWorkspaceUpdate();
          }
          if (event.key === "Escape") cancelEditing();
        }}
        className={`${mobile ? "h-11" : "h-10"} border-line-strong bg-surface-1 text-ink-1 focus-visible:border-brand focus-visible:ring-ring w-full min-w-44 rounded-[var(--radius-panel)] border px-3 text-sm font-semibold shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:outline-none`}
      />
    ) : (
      <span>
        {workspace.name?.trim() ? workspace.name.trim() : "Hồ sơ vật tư"}
      </span>
    );

  const renderWorkspaceActions = (workspace: Workspace, mobile = false) => {
    const isEditing = editingWorkspaceId === workspace.id;
    const size = mobile ? "md" : "sm";

    return isEditing ? (
      <>
        <Button
          variant="primary"
          size={size}
          isLoading={updateMutation.isPending}
          disabled={!editProfileName.trim()}
          onClick={submitWorkspaceUpdate}
          leftIcon={<Check className="h-3.5 w-3.5" />}
        >
          Lưu
        </Button>
        <Button
          variant="ghost"
          size={size}
          disabled={updateMutation.isPending}
          onClick={cancelEditing}
          leftIcon={<X className="h-3.5 w-3.5" />}
        >
          Hủy
        </Button>
      </>
    ) : (
      <>
        <Link
          href={`/material-profiles/${workspace.id}`}
          className={`${buttonBaseClass} ${buttonVariantClass.primary} ${buttonSizeClass[size]}`}
        >
          Tiếp tục
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <Button
          variant="ghost"
          size={size}
          disabled={updateMutation.isPending}
          onClick={() => startEditing(workspace)}
          leftIcon={<Pencil className="h-3.5 w-3.5" />}
        >
          Đổi tên
        </Button>
        <Button
          variant="danger"
          size={size}
          onClick={() => setDeleteTarget(workspace)}
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
        >
          Xóa
        </Button>
      </>
    );
  };

  return (
    <>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Xóa hồ sơ "${deleteTarget?.name?.trim() ? deleteTarget.name.trim() : "Hồ sơ vật tư"}"?`}
        description="Hồ sơ và các dòng đối chiếu liên quan sẽ bị xóa khỏi danh sách. Không thể hoàn tác."
        confirmLabel="Xóa hồ sơ"
        variant="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ workspaceId: deleteTarget.id });
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <div className="grid gap-2">
        <section className="panel p-4">
          <p className="section-title">Hồ sơ mới</p>
          <h2 className="text-ink-1 mt-1 text-base font-semibold">
            Bắt đầu từ sheet vật tư
          </h2>
          <p className="text-ink-2 mt-1 text-sm">
            Tên hồ sơ và Số TBMT chỉ để nhận diện, có thể để trống. Sheet sẽ
            được kiểm tra Tên vật tư, ĐVT và Thông số kỹ thuật ở bước tiếp theo.
          </p>

          <form
            className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate({
                name:
                  profileName.trim().length > 0
                    ? profileName.trim()
                    : undefined,
                noticeNumber:
                  noticeNumber.trim().length > 0
                    ? noticeNumber.trim()
                    : undefined,
              });
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-ink-3 text-xs font-semibold tracking-[0.12em] uppercase">
                Tên hồ sơ (tùy chọn)
              </span>
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="VD: Vật tư gói thầu tháng 7"
                className="border-line-strong bg-surface-1 text-ink-1 focus-visible:border-brand focus-visible:ring-ring h-11 rounded-[var(--radius-panel)] border px-3 text-sm font-semibold shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-3 text-xs font-semibold tracking-[0.12em] uppercase">
                Số TBMT (tùy chọn)
              </span>
              <input
                value={noticeNumber}
                onChange={(event) => setNoticeNumber(event.target.value)}
                placeholder="VD: IB2600190527-00"
                className="border-line-strong bg-surface-1 text-ink-1 focus-visible:border-brand focus-visible:ring-ring h-11 rounded-[var(--radius-panel)] border px-3 text-sm font-semibold shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:outline-none"
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              isLoading={createMutation.isPending}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Tạo & nhập sheet
            </Button>
          </form>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-line border-b px-4 py-4">
            <p className="section-title">Hồ sơ đã tạo</p>
            <h2 className="text-ink-1 mt-1 text-base font-semibold">
              Tiếp tục công việc
            </h2>
          </div>

          {listQuery.isLoading ? (
            <div
              className="p-4"
              role="status"
              aria-label="Đang tải danh sách hồ sơ vật tư"
            >
              <div className="grid gap-3 md:hidden">
                {Array.from({ length: 5 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
              <SkeletonTable rows={5} cols={6} className="hidden md:block" />
            </div>
          ) : listQuery.isError ? (
            <div className="p-5">
              <EmptyState
                title="Không tải được danh sách hồ sơ"
                description={listQuery.error.message}
                cta={
                  <Button
                    variant="secondary"
                    onClick={() => void listQuery.refetch()}
                  >
                    Tải lại
                  </Button>
                }
              />
            </div>
          ) : workspaces.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Chưa có hồ sơ vật tư"
                description="Tạo hồ sơ rồi tải lên sheet có Tên vật tư, ĐVT và Thông số kỹ thuật để bắt đầu xử lý."
                icon={<FileSpreadsheet className="h-6 w-6" aria-hidden />}
              />
            </div>
          ) : (
            <>
              <div className="grid gap-3 p-4 md:hidden">
                {workspaces.map((workspace) => {
                  const isEditing = editingWorkspaceId === workspace.id;
                  return (
                    <article
                      key={workspace.id}
                      className="border-line bg-surface-1 rounded-[var(--radius-panel)] border p-4 shadow-[var(--shadow-flat)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-ink-1 text-base font-semibold">
                            {renderEditInput(workspace, true)}
                          </h3>
                          {workspace.noticeNumber ? (
                            <p className="text-ink-3 mt-1 text-xs">
                              Số TBMT: {workspace.noticeNumber}
                            </p>
                          ) : null}
                        </div>
                        <Badge tone={statusTone(workspace.status)}>
                          {statusLabel[workspace.status]}
                        </Badge>
                      </div>

                      <dl className="border-line mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-y py-3 text-sm">
                        <div className="col-span-2 min-w-0">
                          <dt className="text-ink-3 text-xs font-semibold">
                            File gốc
                          </dt>
                          <dd className="text-ink-2 truncate">
                            {workspace.sourceFileName ?? "Chưa tải lên"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-3 text-xs font-semibold">
                            Số dòng
                          </dt>
                          <dd className="text-ink-1 font-semibold tabular-nums">
                            {workspace.rowCount.toLocaleString("vi-VN")}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-3 text-xs font-semibold">
                            Cập nhật
                          </dt>
                          <dd className="text-ink-2">
                            {formatDate(workspace.updatedAt)}
                          </dd>
                        </div>
                      </dl>

                      {workspace.outputDirPath ? (
                        <Badge tone="success" className="mt-3">
                          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                          Đã có file xuất
                        </Badge>
                      ) : null}

                      <div
                        className={`mt-3 grid gap-2 ${isEditing ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}
                      >
                        {renderWorkspaceActions(workspace, true)}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden max-h-[70vh] overflow-auto md:block">
                <table
                  aria-label="Danh sách hồ sơ vật tư"
                  className="divide-line w-full min-w-[760px] divide-y text-sm"
                >
                  <thead className="bg-surface-2 text-ink-3 sticky top-0 z-10 text-left text-xs font-semibold tracking-wide uppercase">
                    <tr>
                      <th className="px-4 py-3">Hồ sơ</th>
                      <th className="px-4 py-3">File gốc</th>
                      <th className="px-4 py-3">Trạng thái</th>
                      <th className="px-4 py-3 text-right">Dòng</th>
                      <th className="px-4 py-3">Cập nhật</th>
                      <th className="px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-line bg-surface-1 divide-y">
                    {workspaces.map((workspace) => {
                      const isEditing = editingWorkspaceId === workspace.id;
                      return (
                        <tr key={workspace.id}>
                          <td className="text-ink-1 px-4 py-3 font-semibold">
                            {renderEditInput(workspace)}
                            {workspace.noticeNumber ? (
                              <span className="text-ink-3 mt-1 block text-xs font-normal">
                                Số TBMT: {workspace.noticeNumber}
                              </span>
                            ) : null}
                          </td>
                          <td className="text-ink-2 max-w-52 truncate px-4 py-3">
                            {workspace.sourceFileName ?? "Chưa tải lên"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={statusTone(workspace.status)}>
                              {statusLabel[workspace.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {workspace.rowCount.toLocaleString("vi-VN")}
                          </td>
                          <td className="text-ink-2 px-4 py-3">
                            {formatDate(workspace.updatedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              {!isEditing && workspace.outputDirPath ? (
                                <Badge tone="success">
                                  <FolderOpen
                                    className="h-3.5 w-3.5"
                                    aria-hidden
                                  />
                                  Đã có file xuất
                                </Badge>
                              ) : null}
                              {renderWorkspaceActions(workspace)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
