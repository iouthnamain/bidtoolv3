import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { db as appDb } from "~/server/db";
import { materials } from "~/server/db/schema";

export type MaterialWriteDb = typeof appDb;
export type MaterialWriteTx = Parameters<
  Parameters<MaterialWriteDb["transaction"]>[0]
>[0];
export type MaterialWriteHandle = MaterialWriteDb | MaterialWriteTx;
export type MaterialRow = typeof materials.$inferSelect;
export type MaterialPatch = Partial<typeof materials.$inferInsert>;

export class MaterialRevisionConflictError extends TRPCError {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super({
      code: "CONFLICT",
      message:
        "Vật tư đã thay đổi trong lúc bạn chỉnh sửa. Hãy tải lại để xem dữ liệu mới rồi thử lại.",
    });
    this.name = "MaterialRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

export async function lockMaterialForUpdate(
  tx: MaterialWriteTx,
  materialId: number,
): Promise<MaterialRow> {
  const [material] = await tx
    .select()
    .from(materials)
    .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)))
    .limit(1)
    .for("update");

  if (!material) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy vật tư.",
    });
  }

  return material;
}

/**
 * Apply a bounded material patch after the caller has acquired the material
 * row lock. Every material mutation goes through this helper so revisions are
 * advanced by PostgreSQL, rather than by a value read before the lock.
 */
export async function updateLockedMaterial(
  tx: MaterialWriteTx,
  material: MaterialRow,
  patch: MaterialPatch,
  options: { expectedRevision?: number; now?: string } = {},
): Promise<MaterialRow> {
  if (
    options.expectedRevision !== undefined &&
    material.revision !== options.expectedRevision
  ) {
    throw new MaterialRevisionConflictError(material.revision);
  }

  const now = options.now ?? new Date().toISOString();
  const [updated] = await tx
    .update(materials)
    .set({
      ...patch,
      revision: sql`${materials.revision} + 1`,
      updatedAt: patch.updatedAt ?? now,
    })
    .where(eq(materials.id, material.id))
    .returning();

  if (!updated) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy vật tư.",
    });
  }

  return updated;
}

/**
 * Run one material mutation in a short transaction. Callers that already own
 * a transaction should use lockMaterialForUpdate and updateLockedMaterial so
 * related rows keep the documented material-first lock order.
 */
export async function updateMaterial(
  db: MaterialWriteDb,
  materialId: number,
  patch: MaterialPatch,
  options: { expectedRevision?: number; now?: string } = {},
): Promise<MaterialRow> {
  return db.transaction(async (tx) => {
    const material = await lockMaterialForUpdate(tx, materialId);
    return updateLockedMaterial(tx, material, patch, options);
  });
}

export function isMaterialRevisionConflict(
  error: unknown,
): error is MaterialRevisionConflictError {
  return error instanceof MaterialRevisionConflictError;
}
