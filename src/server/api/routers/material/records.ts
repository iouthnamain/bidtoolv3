import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";

import type { db as appDb } from "~/server/db";
import { materials } from "~/server/db/schema";

type AppDb = typeof appDb;

export async function getActiveMaterialById(db: AppDb, id: number) {
  const [material] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, id), isNull(materials.deletedAt)))
    .limit(1);

  if (!material) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy vật tư.",
    });
  }

  return material;
}

export function requireUpdatedMaterial<T>(material: T | undefined): T {
  if (!material) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Không tìm thấy vật tư.",
    });
  }

  return material;
}
