"use client";

import { useState } from "react";
import { ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge, Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { ROLES, type Role } from "~/lib/permissions";
import { usePermissions } from "~/lib/use-permissions";
import { api } from "~/trpc/react";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Quản trị",
  manager: "Quản lý",
  staff: "Nhân viên",
  customer: "Khách hàng",
};

function roleTone(role: string | null | undefined) {
  switch (role) {
    case "admin":
      return "critical" as const;
    case "manager":
      return "info" as const;
    case "staff":
      return "success" as const;
    default:
      return "neutral" as const;
  }
}

const inputClass =
  "h-11 w-full rounded border border-slate-400 bg-white px-3 text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100";
const labelClass =
  "text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase";
const selectClass =
  "h-9 rounded border border-slate-400 bg-white px-2 text-xs text-slate-900 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100";

export function UserManagementSection() {
  const { can, isPending: sessionPending, role: myRole, user: me } =
    usePermissions();
  const allowed = can("users:manage");
  const isAdmin = myRole === "admin";
  const { error: toastError, success } = useToast();
  const utils = api.useUtils();

  // Create-user form state.
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("staff");
  const [newTenantId, setNewTenantId] = useState("");

  // Track which row has an in-flight mutation so we can disable its controls.
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const usersQuery = api.user.list.useQuery(undefined, { enabled: allowed });
  const tenantsQuery = api.tenant.list.useQuery(undefined, { enabled: allowed });
  const users = usersQuery.data ?? [];
  const tenants = tenantsQuery.data ?? [];

  // Roles this operator may assign. Managers cannot create or promote to admin.
  const assignableRoles = isAdmin
    ? ROLES
    : ROLES.filter((r) => r !== "admin");

  const refreshUsers = async () => {
    await utils.user.list.invalidate();
  };

  const createUser = api.user.create.useMutation({
    onSuccess: async () => {
      success("Đã tạo người dùng.");
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewTenantId("");
      setNewRole("staff");
      await refreshUsers();
    },
    onError: (e) => toastError(e.message || "Không tạo được người dùng."),
  });

  const setRole = api.user.setRole.useMutation({
    onSuccess: async () => {
      success("Đã cập nhật quyền.");
      await refreshUsers();
    },
    onError: (e) => toastError(e.message || "Không đổi được quyền."),
    onSettled: () => setBusyUserId(null),
  });

  const setTenant = api.user.setTenant.useMutation({
    onSuccess: async () => {
      success("Đã cập nhật tổ chức.");
      await refreshUsers();
    },
    onError: (e) => toastError(e.message || "Không đổi được tổ chức."),
    onSettled: () => setBusyUserId(null),
  });

  const setBanned = api.user.setBanned.useMutation({
    onSuccess: async (_data, variables) => {
      success(variables.banned ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
      await refreshUsers();
    },
    onError: (e) => toastError(e.message || "Thao tác thất bại."),
    onSettled: () => setBusyUserId(null),
  });

  const deleteUser = api.user.delete.useMutation({
    onSuccess: async () => {
      success("Đã xóa người dùng.");
      await refreshUsers();
    },
    onError: (e) => toastError(e.message || "Không xóa được người dùng."),
    onSettled: () => setBusyUserId(null),
  });

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toastError("Mật khẩu phải có tối thiểu 8 ký tự.");
      return;
    }
    if (newRole === "customer" && !newTenantId) {
      toastError("Tài khoản khách hàng phải thuộc một tổ chức.");
      return;
    }
    createUser.mutate({
      email: newEmail.trim(),
      name: newName.trim(),
      password: newPassword,
      role: newRole,
      tenantId: newRole === "customer" ? newTenantId : null,
    });
  };

  const handleDelete = (userId: string, label: string) => {
    if (
      !window.confirm(
        `Xóa người dùng "${label}"? Hành động này không thể hoàn tác.`,
      )
    ) {
      return;
    }
    setBusyUserId(userId);
    deleteUser.mutate({ userId });
  };

  // Gate the UI: while the session loads, render nothing to avoid flashing.
  if (sessionPending) {
    return null;
  }

  if (!allowed) {
    return (
      <section id="users" className="panel scroll-mt-6 overflow-hidden">
        <SettingsSectionHeader
          eyebrow="Người dùng"
          title="Quản lý người dùng"
          description="Quản lý tài khoản, quyền và trạng thái truy cập."
          icon={Users}
        />
        <div className="px-5 py-6">
          <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Bạn không có quyền truy cập mục này.
          </p>
        </div>
      </section>
    );
  }

  const customerNeedsTenant = newRole === "customer";

  return (
    <section id="users" className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow="Người dùng"
        title="Quản lý người dùng"
        description="Tạo tài khoản, gán quyền, gán tổ chức và khóa/mở khóa truy cập."
        icon={Users}
      />

      <div className="space-y-6 p-2">
        {/* Create user */}
        <form
          onSubmit={handleCreate}
          className="rounded border border-slate-400 bg-slate-50/60 p-4"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <UserPlus className="h-4 w-4 text-blue-700" aria-hidden />
            Thêm người dùng
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="nu-name">
                <span className={labelClass}>Họ tên</span>
              </label>
              <input
                id="nu-name"
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={createUser.isPending}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="nu-email">
                <span className={labelClass}>Email</span>
              </label>
              <input
                id="nu-email"
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={createUser.isPending}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="nu-password">
                <span className={labelClass}>Mật khẩu</span>
              </label>
              <input
                id="nu-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={createUser.isPending}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="nu-role">
                <span className={labelClass}>Quyền</span>
              </label>
              <select
                id="nu-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                disabled={createUser.isPending}
                className={inputClass}
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            {customerNeedsTenant ? (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor="nu-tenant">
                  <span className={labelClass}>Tổ chức (tenant)</span>
                </label>
                <select
                  id="nu-tenant"
                  value={newTenantId}
                  onChange={(e) => setNewTenantId(e.target.value)}
                  disabled={createUser.isPending}
                  className={inputClass}
                >
                  <option value="">— Chọn tổ chức —</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {tenants.length === 0 ? (
                  <span className="text-xs text-amber-700">
                    Chưa có tổ chức nào. Tạo tổ chức ở mục Tổ chức trước khi thêm
                    khách hàng.
                  </span>
                ) : (
                  <span className="text-xs text-slate-700">
                    Tài khoản khách hàng chỉ thấy dữ liệu thuộc tổ chức này.
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col justify-end sm:col-span-2">
                <span className="text-xs text-slate-700">
                  Người dùng nội bộ (admin/quản lý/nhân viên) không thuộc tổ chức
                  nào.
                </span>
              </div>
            )}
          </div>
          <div className="mt-4">
            <Button
              type="submit"
              isLoading={createUser.isPending}
              disabled={
                !newName ||
                !newEmail ||
                !newPassword ||
                (customerNeedsTenant && !newTenantId)
              }
              leftIcon={<UserPlus className="h-3.5 w-3.5" />}
            >
              Tạo người dùng
            </Button>
          </div>
        </form>

        {/* User list */}
        <div className="overflow-hidden rounded border border-slate-400">
          <div className="flex items-center justify-between border-b border-slate-400 bg-slate-50 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ShieldCheck className="h-4 w-4 text-slate-700" aria-hidden />
              Danh sách người dùng
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshUsers()}
              isLoading={usersQuery.isFetching}
            >
              Làm mới
            </Button>
          </div>

          {users.length === 0 && !usersQuery.isLoading ? (
            <p className="px-4 py-6 text-sm text-slate-700">
              Chưa có người dùng nào.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {users.map((row) => {
                const busy = busyUserId === row.id;
                const isSelf = me?.id === row.id;
                // Managers cannot act on admin accounts at all.
                const locked = !isAdmin && row.role === "admin";
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {row.name || row.email}
                        </span>
                        <Badge tone={roleTone(row.role)}>
                          {ROLE_LABELS[row.role] ?? row.role}
                        </Badge>
                        {row.banned ? (
                          <Badge tone="critical">Đã khóa</Badge>
                        ) : null}
                        {isSelf ? <Badge tone="neutral">Bạn</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-700">
                        {row.email}
                        {row.tenantName ? ` · ${row.tenantName}` : ""}
                      </p>
                    </div>

                    {locked ? (
                      <span className="text-xs text-slate-600">
                        Chỉ admin quản lý được tài khoản admin.
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Quyền của ${row.email}`}
                          value={row.role}
                          disabled={busy || isSelf}
                          onChange={(e) => {
                            setBusyUserId(row.id);
                            setRole.mutate({
                              userId: row.id,
                              role: e.target.value as Role,
                            });
                          }}
                          className={selectClass}
                        >
                          {assignableRoles.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>

                        {row.role === "customer" ? (
                          <select
                            aria-label={`Tổ chức của ${row.email}`}
                            value={row.tenantId ?? ""}
                            disabled={busy}
                            onChange={(e) => {
                              setBusyUserId(row.id);
                              setTenant.mutate({
                                userId: row.id,
                                tenantId: e.target.value || null,
                              });
                            }}
                            className={selectClass}
                          >
                            <option value="">— Không tổ chức —</option>
                            {tenants.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        ) : null}

                        <Button
                          variant={row.banned ? "secondary" : "danger"}
                          size="sm"
                          isLoading={busy}
                          disabled={isSelf}
                          onClick={() => {
                            setBusyUserId(row.id);
                            setBanned.mutate({
                              userId: row.id,
                              banned: !row.banned,
                            });
                          }}
                        >
                          {row.banned ? "Mở khóa" : "Khóa"}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || isSelf}
                          onClick={() =>
                            handleDelete(row.id, row.name || row.email)
                          }
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Xóa
                        </Button>
                      </div>
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
