/**
 * Multi-tenant row isolation helpers, driven by the tRPC context.
 *
 * THE TENANCY RULE (single source of truth):
 *   - Internal roles (admin, manager, staff) and the auth-off state see ALL
 *     tenants — there is NO row filter.
 *   - Only `role === "customer"` is restricted to their own tenant. A customer
 *     whose `tenantId` is null can see NOTHING (fail closed) — they must never
 *     read or mutate un-tenanted/global owned rows.
 *
 * These helpers are pure and additive. Routers spread the result of
 * {@link withTenant} into their existing `and(...)` / `.where(...)` clauses, and
 * wrap insert values with {@link stampTenant}. Service-layer code that cannot
 * see `ctx` receives a {@link TenantScopeValue} (resolved via
 * {@link tenantScopeValue}) and applies it with {@link tenantConditionForValue}.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Role } from "~/lib/permissions";

/**
 * The minimal slice of tRPC context these helpers need. Structurally matches
 * the real context shape from `createTRPCContext`.
 */
export type TenantScopeContext = {
  authEnabled: boolean;
  tenantId: string | null;
  user: { role: Role; tenantId: string | null } | null;
};

/**
 * The resolved tenant filter:
 *   - `undefined` → no filtering (internal role or auth disabled): see everything.
 *   - `string`    → filter to exactly this tenantId (a scoped customer).
 *   - `null`      → match NOTHING (a customer with no tenant): fail closed.
 *
 * This is what gets threaded into service functions that cannot read `ctx`.
 */
export type TenantScopeValue = string | null | undefined;

/**
 * Resolve the tenant filter from context. See {@link TenantScopeValue} for the
 * meaning of each return. Only customers are ever restricted; everyone else
 * (and auth-off) sees all rows.
 */
export function tenantScopeValue(ctx: TenantScopeContext): TenantScopeValue {
  // Auth disabled: behave exactly as the pre-rollout single-tenant app — no filter.
  if (!ctx.authEnabled) {
    return undefined;
  }

  // Customers are confined to their own tenant. A null tenantId stays null so
  // {@link tenantConditionForValue} turns it into an impossible condition.
  if (ctx.user?.role === "customer") {
    return ctx.user.tenantId;
  }

  // Internal roles (admin/manager/staff) and anonymous see everything.
  return undefined;
}

/**
 * Turn a resolved {@link TenantScopeValue} into a Drizzle condition for the
 * given column, or `undefined` when no filtering applies (so it can be spread
 * into `and(...)` / `.where(...)` safely). A null value (customer without a
 * tenant) yields `sql\`false\`` — fail closed, never open.
 */
export function tenantConditionForValue(
  value: TenantScopeValue,
  column: AnyPgColumn,
): SQL | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    // Customer with no tenant: match nothing rather than leaking global rows.
    return sql`false`;
  }
  return eq(column, value);
}

/**
 * Router convenience: resolve the scope from `ctx` and build the condition for
 * `column` in one step. Returns `undefined` when scoping does not apply.
 */
export function withTenant(
  ctx: TenantScopeContext,
  column: AnyPgColumn,
): SQL | undefined {
  return tenantConditionForValue(tenantScopeValue(ctx), column);
}

/**
 * The tenantId to attribute newly-created owned rows to. Always the creator's
 * own tenant: null for internal users, the customer's tenant for customers.
 * Threaded into service insert functions that cannot read `ctx`.
 */
export function creatorTenantId(ctx: TenantScopeContext): string | null {
  return ctx.tenantId ?? null;
}

/**
 * Stamp the creator's tenantId onto insert values for an owned table.
 *
 * Design choice: we always set `tenantId: ctx.tenantId ?? null` regardless of
 * role. Internal-created rows are intentionally un-tenanted (null); customer-
 * created rows are attributed to that customer's tenant. This is the simplest
 * rule that keeps created rows correctly owned and never mis-attributes a row
 * to a tenant the creator does not belong to.
 */
export function stampTenant<T extends Record<string, unknown>>(
  ctx: TenantScopeContext,
  values: T,
): T & { tenantId: string | null } {
  return { ...values, tenantId: ctx.tenantId ?? null };
}
