"use client";

import { useState } from "react";
import { Building2, Pencil, Plus, Trash2, X } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge, Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { usePermissions } from "~/lib/use-permissions";
import { api } from "~/trpc/react";

const inputClass =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100";
const labelClass =
  "text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase";

export function TenantManagementSection() {
  const { can, isPending: sessionPending } = usePermissions();
  const allowed = can("users:manage");
  const { error: toastError, success } = useToast();
  const utils = api.useUtils();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const tenantsQuery = api.tenant.list.useQuery(undefined, {
    enabled: allowed,
  });
  const tenants = tenantsQuery.data ?? [];

  const refresh = async () => {
    await utils.tenant.list.invalidate();
  };

  const createTenant = api.tenant.create.useMutation({
    onSuccess: async () => {
      success("Đã tạo tổ chức.");
      setNewName("");
      await refresh();
    },
    onError: (e) => toastError(e.message || "Không tạo được tổ chức."),
  });

  const renameTenant = api.tenant.rename.useMutation({
    onSuccess: async () => {
      success("Đã đổi tên tổ chức.");
      setEditingId(null);
      setEditingName("");
      await refresh();
    },
    onError: (e) => toastError(e.message || "Không đổi được tên."),
    onSettled: () => setBusyId(null),
  });

  const deleteTenant = api.tenant.delete.useMutation({
    onSuccess: async () => {
      success("Đã xóa tổ chức.");
      await refresh();
    },
    onError: (e) => toastError(e.message || "Không xóa được tổ chức."),
    onSettled: () => setBusyId(null),
  });

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newName.trim()) return;
    createTenant.mutate({ name: newName.trim() });
  };

  const handleRename = (id: string) => {
    if (!editingName.trim()) return;
    setBusyId(id);
    renameTenant.mutate({ id, name: editingName.trim() });
  };

  const handleDelete = (id: string, name: string, userCount: number) => {
    if (userCount > 0) {
      toastError(
        `Không thể xóa "${name}": còn ${userCount} người dùng. Hãy chuyển họ sang tổ chức khác trước.`,
      );
      return;
    }
    if (
      !window.confirm(`Xóa tổ chức "${name}"? Hành động này không thể hoàn tác.`)
    ) {
      return;
    }
    setBusyId(id);
    deleteTenant.mutate({ id });
  };

  if (sessionPending) {
    return null;
  }

  if (!allowed) {
    return (
      <section id="tenants" className="panel scroll-mt-6 overflow-hidden">
        <SettingsSectionHeader
          eyebrow="Tổ chức"
          title="Quản lý tổ chức"
          description="Tạo và quản lý các tổ chức khách hàng (tenant)."
          icon={Building2}
        />
        <div className="px-5 py-6">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Bạn không có quyền truy cập mục này.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="tenants" className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow="Tổ chức"
        title="Quản lý tổ chức"
        description="Mỗi tổ chức (tenant) là một khách hàng. Tài khoản khách hàng chỉ thấy dữ liệu thuộc tổ chức của họ."
        icon={Building2}
      />

      <div className="space-y-6 p-5">
        {/* Create tenant */}
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Plus className="h-4 w-4 text-sky-700" aria-hidden />
            Thêm tổ chức
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="nt-name">
                <span className={labelClass}>Tên tổ chức</span>
              </label>
              <input
                id="nt-name"
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={createTenant.isPending}
                placeholder="VD: Công ty TNHH ABC"
                className={inputClass}
              />
            </div>
            <Button
              type="submit"
              isLoading={createTenant.isPending}
              disabled={!newName.trim()}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Tạo tổ chức
            </Button>
          </div>
        </form>

        {/* Tenant list */}
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Building2 className="h-4 w-4 text-slate-500" aria-hidden />
              Danh sách tổ chức
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              isLoading={tenantsQuery.isFetching}
            >
              Làm mới
            </Button>
          </div>

          {tenants.length === 0 && !tenantsQuery.isLoading ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              Chưa có tổ chức nào.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tenants.map((t) => {
                const busy = busyId === t.id;
                const editing = editingId === t.id;
                return (
                  <li
                    key={t.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    {editing ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          disabled={busy}
                          className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          isLoading={busy}
                          disabled={!editingName.trim()}
                          onClick={() => handleRename(t.id)}
                        >
                          Lưu
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(null);
                            setEditingName("");
                          }}
                          leftIcon={<X className="h-3.5 w-3.5" />}
                        >
                          Hủy
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900">
                              {t.name}
                            </span>
                            <Badge tone={t.userCount > 0 ? "info" : "neutral"}>
                              {t.userCount} người dùng
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            slug: {t.slug}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(t.id);
                              setEditingName(t.name);
                            }}
                            leftIcon={<Pencil className="h-3.5 w-3.5" />}
                          >
                            Đổi tên
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            isLoading={busy}
                            disabled={t.userCount > 0}
                            onClick={() =>
                              handleDelete(t.id, t.name, t.userCount)
                            }
                            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                          >
                            Xóa
                          </Button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
