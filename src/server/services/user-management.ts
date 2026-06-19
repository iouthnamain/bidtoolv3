import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { ROLES, type Role } from "~/lib/permissions";
import { tenant, user } from "~/server/db/schema";

/**
 * User management service (admin/manager governance).
 *
 * Why this exists rather than calling Better Auth's admin plugin from the client:
 *   1. Better Auth's admin plugin is configured with `adminRoles: ["admin"]`
 *      (src/server/auth.ts), so it rejects EVERY admin call from a `manager` —
 *      yet the app's RBAC grants managers `users:manage`. Routing user CRUD
 *      through tRPC + this service makes the app's permission model the single
 *      source of truth and fixes that mismatch.
 *   2. Better Auth's `tenantId` additional field is `input: false`, so it cannot
 *      be set or changed via the admin API. Tenant assignment/reassignment has
 *      to be a direct DB update.
 *   3. We need privilege-escalation guards (only admins touch admin accounts)
 *      and a last-admin lockout guard, which the plugin does not provide.
 *
 * Password hashing and account-row creation still go through Better Auth
 * (`auth.api.signUpEmail`) so credentials are handled exactly like sign-up and
 * the /setup bootstrap. Role and tenant are applied as a direct DB update right
 * after, mirroring src/app/api/setup/route.ts.
 */

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  banned: boolean;
  tenantId: string | null;
  tenantName: string | null;
  createdAt: Date;
}

/** The acting user's identity, resolved from tRPC context. */
export interface ActingUser {
  id: string;
  role: Role;
}

function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

/**
 * Privilege-escalation guard. Managers have `users:manage` but must not be able
 * to create, become, promote-to, or modify ADMIN accounts — only admins may
 * touch the admin tier. Throws when a non-admin acts on the admin role or on an
 * existing admin user.
 */
function assertCanActOnAdmin(
  acting: ActingUser,
  opts: { targetRole?: Role | null; targetIsAdmin?: boolean },
): void {
  if (acting.role === "admin") return; // admins may do anything
  if (opts.targetRole === "admin" || opts.targetIsAdmin) {
    throw new Error(
      "Chỉ quản trị viên (admin) mới có thể tạo hoặc thay đổi tài khoản admin.",
    );
  }
}

/** Count admins that are not banned — used to prevent locking out the last one. */
async function activeAdminCount(): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(user)
    .where(and(eq(user.role, "admin"), ne(user.banned, true)));
  return rows[0]?.value ?? 0;
}

/**
 * Guard: refuse an operation that would remove the final active admin (demotion,
 * ban, or deletion of the last admin). Without this an admin could accidentally
 * lock everyone out of governance.
 */
async function assertNotLastAdmin(targetUserId: string): Promise<void> {
  const target = await db
    .select({ role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);

  const row = target[0];
  if (row?.role !== "admin" || row.banned === true) {
    // Target isn't a counted active admin, so the operation can't drop the last.
    return;
  }
  if ((await activeAdminCount()) <= 1) {
    throw new Error(
      "Không thể thực hiện: đây là tài khoản admin hoạt động cuối cùng.",
    );
  }
}

/** List all users with their tenant name joined in, newest first. */
export async function listUsers(): Promise<ManagedUser[]> {
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      banned: user.banned,
      tenantId: user.tenantId,
      tenantName: tenant.name,
      createdAt: user.createdAt,
    })
    .from(user)
    .leftJoin(tenant, eq(user.tenantId, tenant.id))
    .orderBy(desc(user.createdAt));

  return rows.map((r) => ({
    ...r,
    banned: r.banned ?? false,
  }));
}

interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
  tenantId: string | null;
}

export async function createManagedUser(
  acting: ActingUser,
  input: CreateUserInput,
): Promise<void> {
  assertCanActOnAdmin(acting, { targetRole: input.role });

  // Customers must have a tenant; internal roles must not (the tenancy rule in
  // tenant-scope.ts: only customers are tenant-scoped, internal users see all).
  const tenantId = input.role === "customer" ? input.tenantId : null;
  if (input.role === "customer" && !tenantId) {
    throw new Error("Tài khoản khách hàng phải thuộc một tổ chức (tenant).");
  }
  if (tenantId) {
    const exists = await db
      .select({ id: tenant.id })
      .from(tenant)
      .where(eq(tenant.id, tenantId))
      .limit(1);
    if (exists.length === 0) {
      throw new Error("Tổ chức (tenant) không tồn tại.");
    }
  }

  // Create via Better Auth so the password is hashed and the account row is
  // created exactly as in sign-up / setup. signUpEmail can't set role/tenant.
  await auth.api.signUpEmail({
    body: {
      name: input.name.trim(),
      email: input.email.trim(),
      password: input.password,
    },
  });

  // Apply role + tenant directly. Mark emailVerified so the created user is
  // never blocked by a verification wall (verification is disabled app-wide).
  await db
    .update(user)
    .set({
      role: input.role,
      tenantId,
      emailVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(user.email, input.email.trim()));
}

export async function setUserRole(
  acting: ActingUser,
  targetUserId: string,
  role: Role,
): Promise<void> {
  if (!isValidRole(role)) {
    throw new Error("Quyền không hợp lệ.");
  }

  const target = await db
    .select({ role: user.role, tenantId: user.tenantId })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);
  const current = target[0];
  if (!current) {
    throw new Error("Không tìm thấy người dùng.");
  }

  // Non-admins may neither touch an existing admin nor promote anyone to admin.
  assertCanActOnAdmin(acting, {
    targetRole: role,
    targetIsAdmin: current.role === "admin",
  });

  // Demoting the last active admin would lock out governance.
  if (current.role === "admin" && role !== "admin") {
    await assertNotLastAdmin(targetUserId);
  }

  // Keep the tenancy invariant: a user leaving the customer role drops its
  // tenant; a user becoming a customer needs one assigned separately.
  const nextTenantId = role === "customer" ? current.tenantId : null;

  await db
    .update(user)
    .set({ role, tenantId: nextTenantId, updatedAt: new Date() })
    .where(eq(user.id, targetUserId));
}

/**
 * Assign or change a user's tenant. Only meaningful for customers (internal
 * roles are un-tenanted). Pass null to clear. Refuses to tenant a non-customer.
 */
export async function setUserTenant(
  acting: ActingUser,
  targetUserId: string,
  tenantId: string | null,
): Promise<void> {
  const target = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);
  const current = target[0];
  if (!current) {
    throw new Error("Không tìm thấy người dùng.");
  }

  assertCanActOnAdmin(acting, { targetIsAdmin: current.role === "admin" });

  if (current.role !== "customer") {
    throw new Error(
      "Chỉ tài khoản khách hàng mới gán được tổ chức. Người dùng nội bộ không thuộc tenant.",
    );
  }
  if (tenantId) {
    const exists = await db
      .select({ id: tenant.id })
      .from(tenant)
      .where(eq(tenant.id, tenantId))
      .limit(1);
    if (exists.length === 0) {
      throw new Error("Tổ chức (tenant) không tồn tại.");
    }
  }

  await db
    .update(user)
    .set({ tenantId, updatedAt: new Date() })
    .where(eq(user.id, targetUserId));
}

export async function setUserBanned(
  acting: ActingUser,
  targetUserId: string,
  banned: boolean,
): Promise<void> {
  if (acting.id === targetUserId) {
    throw new Error("Bạn không thể tự khóa tài khoản của mình.");
  }

  const target = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);
  const current = target[0];
  if (!current) {
    throw new Error("Không tìm thấy người dùng.");
  }

  assertCanActOnAdmin(acting, { targetIsAdmin: current.role === "admin" });

  if (banned) {
    await assertNotLastAdmin(targetUserId);
  }

  await db
    .update(user)
    .set({ banned, updatedAt: new Date() })
    .where(eq(user.id, targetUserId));

  // Banning must immediately revoke access: drop all of the user's sessions so
  // an already-signed-in banned user is kicked on their next request. (Sessions
  // are validated server-side per request via getSession.)
  if (banned) {
    await db.execute(
      sql`DELETE FROM "session" WHERE "user_id" = ${targetUserId}`,
    );
  }
}

export async function deleteManagedUser(
  acting: ActingUser,
  targetUserId: string,
): Promise<void> {
  if (acting.id === targetUserId) {
    throw new Error("Bạn không thể xóa tài khoản của chính mình.");
  }

  const target = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);
  const current = target[0];
  if (!current) {
    throw new Error("Không tìm thấy người dùng.");
  }

  assertCanActOnAdmin(acting, { targetIsAdmin: current.role === "admin" });
  await assertNotLastAdmin(targetUserId);

  // session + account rows cascade on user delete (onDelete: "cascade").
  await db.delete(user).where(eq(user.id, targetUserId));
}
