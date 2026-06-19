import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, requirePermission } from "~/server/api/trpc";
import { ROLES } from "~/lib/permissions";
import type { ActingUser } from "~/server/services/user-management";
import {
  createManagedUser,
  deleteManagedUser,
  listUsers,
  setUserBanned,
  setUserRole,
  setUserTenant,
} from "~/server/services/user-management";

const roleSchema = z.enum(ROLES);

/**
 * Resolve the acting user from context. When auth is disabled there is no
 * session user; the app-wide invariant is that auth-off behaves as full access,
 * so we act as a synthetic admin. When auth is on, `requirePermission` has
 * already guaranteed a user with `users:manage`.
 */
function actingFrom(ctx: {
  authEnabled: boolean;
  user: { id: string; role: (typeof ROLES)[number] } | null;
}): ActingUser {
  if (!ctx.authEnabled) {
    return { id: "__auth_off__", role: "admin" };
  }
  if (!ctx.user) {
    // Should be unreachable behind requirePermission, but fail closed.
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return { id: ctx.user.id, role: ctx.user.role };
}

/** Map a service-layer Error message to a tRPC error the client can surface. */
function toTRPCError(error: unknown): TRPCError {
  const message =
    error instanceof Error ? error.message : "Thao tác thất bại.";
  return new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * User management API. Gated by `users:manage` (admin + manager). Privilege
 * boundaries (only admins manage admins; last-admin lockout) live in the service
 * layer so they hold regardless of caller. See user-management.ts.
 */
export const userRouter = createTRPCRouter({
  list: requirePermission("users:manage").query(async () => {
    return listUsers();
  }),

  create: requirePermission("users:manage")
    .input(
      z.object({
        email: z.string().trim().email(),
        name: z.string().trim().min(1).max(200),
        password: z.string().min(8).max(200),
        role: roleSchema,
        tenantId: z.string().min(1).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await createManagedUser(actingFrom(ctx), input);
        return { ok: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setRole: requirePermission("users:manage")
    .input(z.object({ userId: z.string().min(1), role: roleSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await setUserRole(actingFrom(ctx), input.userId, input.role);
        return { ok: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setTenant: requirePermission("users:manage")
    .input(
      z.object({
        userId: z.string().min(1),
        tenantId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await setUserTenant(actingFrom(ctx), input.userId, input.tenantId);
        return { ok: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setBanned: requirePermission("users:manage")
    .input(z.object({ userId: z.string().min(1), banned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await setUserBanned(actingFrom(ctx), input.userId, input.banned);
        return { ok: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  delete: requirePermission("users:manage")
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await deleteManagedUser(actingFrom(ctx), input.userId);
        return { ok: true };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
