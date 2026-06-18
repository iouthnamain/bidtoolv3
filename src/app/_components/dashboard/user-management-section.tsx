"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, UserPlus, Users } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge, Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { ROLES, type Role } from "~/lib/permissions";
import { usePermissions } from "~/lib/use-permissions";

/** Shape of a user row from the admin listUsers endpoint that we render. */
interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  tenantId?: string | null;
}

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

// The admin client types `role` as the configured Better Auth roles
// ("admin" | "user" by default); our app uses a wider DB enum that the server
// accepts at runtime. Cast through unknown at the call boundary only.
function asAdminRole(role: Role): "admin" {
  return role as unknown as "admin";
}

const inputClass =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100";
const labelClass =
  "text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase";

export function UserManagementSection() {
  const { can, isPending: sessionPending } = usePermissions();
  const allowed = can("users:manage");
  const { error: toastError, success } = useToast();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Create-user form state.
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("staff");
  const [newTenantId, setNewTenantId] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    const result = await authClient.admin.listUsers({
      query: { limit: 200, sortBy: "createdAt", sortDirection: "desc" },
    });
    if (result.error) {
      toastError(result.error.message ?? "Không tải được danh sách người dùng.");
      setIsLoading(false);
      return;
    }
    setUsers((result.data?.users ?? []) as AdminUserRow[]);
    setIsLoading(false);
  }, [toastError]);

  useEffect(() => {
    if (allowed) {
      void loadUsers();
    }
  }, [allowed, loadUsers]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toastError("Mật khẩu phải có tối thiểu 8 ký tự.");
      return;
    }
    setIsCreating(true);
    const tenantId = newTenantId.trim();
    const result = await authClient.admin.createUser({
      email: newEmail.trim(),
      name: newName.trim(),
      password: newPassword,
      role: asAdminRole(newRole),
      ...(tenantId ? { data: { tenantId } } : {}),
    });
    if (result.error) {
      toastError(result.error.message ?? "Không tạo được người dùng.");
      setIsCreating(false);
      return;
    }
    success("Đã tạo người dùng.");
    setNewEmail("");
    setNewName("");
    setNewPassword("");
    setNewTenantId("");
    setNewRole("staff");
    setIsCreating(false);
    await loadUsers();
  };

  const handleRoleChange = async (userId: string, role: Role) => {
    setBusyUserId(userId);
    const result = await authClient.admin.setRole({ userId, role: asAdminRole(role) });
    if (result.error) {
      toastError(result.error.message ?? "Không đổi được quyền.");
    } else {
      success("Đã cập nhật quyền.");
      await loadUsers();
    }
    setBusyUserId(null);
  };

  const handleToggleBan = async (row: AdminUserRow) => {
    setBusyUserId(row.id);
    const result = row.banned
      ? await authClient.admin.unbanUser({ userId: row.id })
      : await authClient.admin.banUser({ userId: row.id });
    if (result.error) {
      toastError(result.error.message ?? "Thao tác thất bại.");
    } else {
      success(row.banned ? "Đã mở khóa tài khoản." : "Đã khóa tài khoản.");
      await loadUsers();
    }
    setBusyUserId(null);
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
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Bạn không có quyền truy cập mục này.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="users" className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow="Người dùng"
        title="Quản lý người dùng"
        description="Tạo tài khoản, gán quyền và khóa/mở khóa truy cập."
        icon={Users}
      />

      <div className="space-y-6 p-5">
        {/* Create user */}
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <UserPlus className="h-4 w-4 text-sky-700" aria-hidden />
            Thêm người dùng
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
                disabled={isCreating}
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
                disabled={isCreating}
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
                disabled={isCreating}
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
                disabled={isCreating}
                className={inputClass}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="nu-tenant">
                <span className={labelClass}>Tenant ID (tùy chọn)</span>
              </label>
              <input
                id="nu-tenant"
                type="text"
                value={newTenantId}
                onChange={(e) => setNewTenantId(e.target.value)}
                disabled={isCreating}
                placeholder="Để trống nếu là người dùng nội bộ"
                className={inputClass}
              />
              <span className="text-xs text-slate-500">
                Nhập tenant ID cho tài khoản khách hàng. Sẽ thay bằng bộ chọn
                tenant sau.
              </span>
            </div>
          </div>
          <div className="mt-4">
            <Button
              type="submit"
              isLoading={isCreating}
              disabled={!newName || !newEmail || !newPassword}
              leftIcon={<UserPlus className="h-3.5 w-3.5" />}
            >
              Tạo người dùng
            </Button>
          </div>
        </form>

        {/* User list */}
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden />
              Danh sách người dùng
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadUsers()}
              isLoading={isLoading}
            >
              Làm mới
            </Button>
          </div>

          {users.length === 0 && !isLoading ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              Chưa có người dùng nào.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {users.map((row) => {
                const busy = busyUserId === row.id;
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {row.name || row.email}
                        </span>
                        <Badge tone={roleTone(row.role)}>
                          {ROLE_LABELS[(row.role as Role) ?? "customer"] ??
                            row.role ??
                            "—"}
                        </Badge>
                        {row.banned ? (
                          <Badge tone="critical">Đã khóa</Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {row.email}
                        {row.tenantId ? ` · tenant: ${row.tenantId}` : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Quyền của ${row.email}`}
                        value={(row.role as Role) ?? "customer"}
                        disabled={busy}
                        onChange={(e) =>
                          void handleRoleChange(row.id, e.target.value as Role)
                        }
                        className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant={row.banned ? "secondary" : "danger"}
                        size="sm"
                        isLoading={busy}
                        onClick={() => void handleToggleBan(row)}
                      >
                        {row.banned ? "Mở khóa" : "Khóa"}
                      </Button>
                    </div>
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
