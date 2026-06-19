import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { tenant, user } from "~/server/db/schema";

/**
 * Tenant management service (admin/manager governance).
 *
 * Tenants are customer organizations. Internal users (admin/manager/staff) are
 * un-tenanted (tenantId null); only customers belong to a tenant. See
 * `src/server/api/tenant-scope.ts` for the row-isolation rule this feeds.
 *
 * This is the only write path for tenants other than the one-time `host` tenant
 * seeded by `scripts/auth-backfill.ts` / `auth-bootstrap.ts`. All callers are
 * gated by the `users:manage` permission at the router layer.
 */

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  userCount: number;
  createdAt: Date;
}

/**
 * Turn a free-form tenant name into a URL-safe slug base. Collapses runs of
 * non-alphanumerics to a single dash and trims leading/trailing dashes. Falls
 * back to "tenant" when the name has no usable characters (e.g. all symbols).
 */
function slugifyBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (Vietnamese-friendly)
    .replace(/[đĐ]/g, "d") // đ/Đ → d (not decomposed by NFKD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "tenant";
}

/**
 * Generate a slug that does not collide with an existing tenant. Appends -2, -3,
 * … until free. The unique index on tenant.slug is the ultimate guard; this just
 * avoids the common-case conflict so the insert succeeds first try.
 */
async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugifyBase(name);
  const existing = await db
    .select({ slug: tenant.slug })
    .from(tenant)
    .where(sql`${tenant.slug} = ${base} OR ${tenant.slug} LIKE ${base + "-%"}`);

  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(base)) return base;

  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** List all tenants with a live count of users attributed to each. */
export async function listTenants(): Promise<TenantRow[]> {
  const rows = await db
    .select({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      createdAt: tenant.createdAt,
      userCount: sql<number>`count(${user.id})::int`,
    })
    .from(tenant)
    .leftJoin(user, eq(user.tenantId, tenant.id))
    .groupBy(tenant.id)
    .orderBy(asc(tenant.name));

  return rows;
}

/** Create a tenant, deriving a unique slug from the name. */
export async function createTenant(name: string): Promise<TenantRow> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Tên tổ chức không được để trống.");
  }

  const slug = await generateUniqueSlug(trimmed);
  const inserted = await db
    .insert(tenant)
    .values({ name: trimmed, slug })
    .returning({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      createdAt: tenant.createdAt,
    });

  const row = inserted[0];
  if (!row) {
    throw new Error("Không thể tạo tổ chức.");
  }
  return { ...row, userCount: 0 };
}

/** Rename a tenant. The slug is intentionally left stable to avoid breaking any
 * external reference; only the display name changes. */
export async function renameTenant(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Tên tổ chức không được để trống.");
  }

  const updated = await db
    .update(tenant)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(tenant.id, id))
    .returning({ id: tenant.id });

  if (updated.length === 0) {
    throw new Error("Không tìm thấy tổ chức.");
  }
}

/**
 * Delete a tenant. Refuses if any user still belongs to it: the user.tenantId FK
 * is `onDelete: set null`, so deleting a tenant with members would silently
 * orphan those customers to a null tenant — which tenant-scope.ts treats as
 * fail-closed (they would see nothing). Forcing the caller to reassign or remove
 * members first keeps the data model coherent and the intent explicit.
 */
export async function deleteTenant(id: string): Promise<void> {
  const members = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(user)
    .where(eq(user.tenantId, id));

  const memberCount = members[0]?.value ?? 0;
  if (memberCount > 0) {
    throw new Error(
      `Không thể xóa: vẫn còn ${memberCount} người dùng thuộc tổ chức này. Hãy chuyển hoặc xóa họ trước.`,
    );
  }

  const deleted = await db
    .delete(tenant)
    .where(eq(tenant.id, id))
    .returning({ id: tenant.id });

  if (deleted.length === 0) {
    throw new Error("Không tìm thấy tổ chức.");
  }
}
