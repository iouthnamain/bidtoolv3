import { z } from "zod";

import { createTRPCRouter, requirePermission } from "~/server/api/trpc";
import {
  createTenant,
  deleteTenant,
  listTenants,
  renameTenant,
} from "~/server/services/tenant-management";

/**
 * Tenant management API. Every procedure is gated by `users:manage` (admin +
 * manager) — tenants are governance, not operational data. See
 * `src/server/services/tenant-management.ts` for the rules enforced.
 */
export const tenantRouter = createTRPCRouter({
  list: requirePermission("users:manage").query(async () => {
    return listTenants();
  }),

  create: requirePermission("users:manage")
    .input(z.object({ name: z.string().trim().min(1).max(200) }))
    .mutation(async ({ input }) => {
      return createTenant(input.name);
    }),

  rename: requirePermission("users:manage")
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ input }) => {
      await renameTenant(input.id, input.name);
      return { ok: true };
    }),

  delete: requirePermission("users:manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await deleteTenant(input.id);
      return { ok: true };
    }),
});
