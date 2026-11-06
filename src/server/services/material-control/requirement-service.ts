import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { db } from "~/server/db";
import type * as materialControlSchema from "~/server/db/schema";
import {
  materialControlLocations,
  materialControlPlans,
  materialControlRequirements,
  materials,
} from "~/server/db/schema";
import {
  calculateRequirementQuantities,
  parseMaterialSnapshot,
} from "~/server/services/material-control/quantity-formulas";
import type {
  MaterialSnapshot,
  RequirementQuantitySummary,
  RequirementSnapshot,
} from "~/server/services/material-control/types";
import {
  MaterialControlServiceError,
  normalizeOptionalDate,
} from "~/server/services/material-control/project-service";

type AppDb = typeof db;
type QueryDb = PgDatabase<PgQueryResultHKT, typeof materialControlSchema>;
type RequirementRow = typeof materialControlRequirements.$inferSelect;
type PlanRow = typeof materialControlPlans.$inferSelect;
type MaterialRow = typeof materials.$inferSelect;

export type CreateRequirementInput = Readonly<{
  planId: number;
  materialId?: number | null;
  materialName?: string;
  specText?: string;
  unit?: string;
  quantity: number;
  requiredAt?: string | Date | null;
  targetLocationId?: number | null;
  status?: "open" | "partially_fulfilled" | "fulfilled" | "cancelled";
  notes?: string;
}>;

export type UpdateRequirementInput = Readonly<{
  id: number;
  materialId?: number | null;
  quantity?: number;
  requiredAt?: string | Date | null;
  targetLocationId?: number | null;
  status?: "open" | "partially_fulfilled" | "fulfilled" | "cancelled";
  notes?: string;
}>;

export type RequirementView = Readonly<{
  id: number;
  planId: number;
  material: MaterialSnapshot;
  materialId: number | null;
  materialName: string;
  specText: string;
  unit: string;
  quantity: number;
  requiredAt: string | null;
  targetLocationId: number | null;
  status: "open" | "partially_fulfilled" | "fulfilled" | "cancelled";
  notes: string;
  summary: RequirementQuantitySummary;
  createdAt: string;
  updatedAt: string;
}>;

export type ListRequirementsInput = Readonly<{
  planId: number;
  status?: "open" | "partially_fulfilled" | "fulfilled" | "cancelled";
  keyword?: string;
}>;

export type PlanSummaryView = Readonly<{
  planId: number;
  requirementCount: number;
  openRequirementCount: number;
  fulfilledRequirementCount: number;
  totalRequiredQuantity: number;
  requirements: readonly RequirementView[];
}>;

function fail(
  code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST",
  message: string,
): never {
  throw new MaterialControlServiceError(code, message);
}

function positiveInteger(value: number | null | undefined): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Number.isInteger(value) &&
    value > 0
  );
}

export function validateRequirementQuantity(
  value: unknown,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("BAD_REQUEST", "Số lượng phải là số hữu hạn lớn hơn 0.");
  }
  const decimals = value.toString().split(".")[1]?.length ?? 0;
  if (decimals > 3) {
    fail("BAD_REQUEST", "Số lượng chỉ được có tối đa 3 chữ số thập phân.");
  }
}

export function validateRequirementDate(
  value: string | Date | null | undefined,
): string | null {
  return normalizeOptionalDate(value, "Ngày cần vật tư");
}

/**
 * Build and validate the immutable snapshot stored on a requirement. The
 * catalog row is only a fallback for omitted fields; an explicitly supplied
 * snapshot is preserved even when the catalog changes later.
 */
export function captureRequirementSnapshot(
  input: Pick<
    CreateRequirementInput,
    "materialId" | "materialName" | "specText" | "unit"
  >,
  catalog?: Pick<MaterialRow, "id" | "name" | "specText" | "unit"> | null,
): MaterialSnapshot {
  const snapshotText = (
    value: string | undefined,
    fallback: string | undefined,
  ) => {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
    return fallback;
  };
  const snapshot = parseMaterialSnapshot({
    materialId: input.materialId ?? null,
    materialName: snapshotText(input.materialName, catalog?.name),
    specText: snapshotText(input.specText, catalog?.specText),
    unit: snapshotText(input.unit, catalog?.unit),
  });
  if (catalog && snapshot.materialId !== catalog.id) {
    fail("BAD_REQUEST", "Liên kết vật tư không khớp với bản chụp vật tư.");
  }
  return snapshot;
}

function snapshotFromRow(row: RequirementRow): MaterialSnapshot {
  return {
    materialId: row.materialId,
    materialName: row.materialName,
    specText: row.specText,
    unit: row.unit,
  };
}

function requirementSnapshot(row: RequirementRow): RequirementSnapshot {
  return {
    ...snapshotFromRow(row),
    id: row.id,
    quantity: Number(row.quantity),
    requiredAt: row.requiredAt,
    targetLocationId: row.targetLocationId,
    status: row.status,
  };
}

function requirementView(row: RequirementRow): RequirementView {
  const snapshot = requirementSnapshot(row);
  return {
    id: row.id,
    planId: row.planId,
    material: snapshotFromRow(row),
    materialId: row.materialId,
    materialName: row.materialName,
    specText: row.specText,
    unit: row.unit,
    quantity: Number(row.quantity),
    requiredAt: row.requiredAt,
    targetLocationId: row.targetLocationId,
    status: row.status,
    notes: row.notes,
    summary: calculateRequirementQuantities({ requirement: snapshot }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function planById(database: QueryDb, id: number): Promise<PlanRow> {
  const [plan] = await database
    .select()
    .from(materialControlPlans)
    .where(eq(materialControlPlans.id, id))
    .limit(1);
  if (!plan) fail("NOT_FOUND", "Kế hoạch không tồn tại.");
  return plan;
}

async function materialById(
  database: QueryDb,
  id: number,
): Promise<MaterialRow> {
  const [material] = await database
    .select()
    .from(materials)
    .where(and(eq(materials.id, id), isNull(materials.deletedAt)))
    .limit(1);
  if (!material) fail("NOT_FOUND", "Vật tư catalog không tồn tại.");
  return material;
}

async function validateTargetLocation(
  database: QueryDb,
  projectId: number,
  targetLocationId: number | null,
): Promise<void> {
  if (targetLocationId === null) return;
  const [location] = await database
    .select({
      id: materialControlLocations.id,
      projectId: materialControlLocations.projectId,
      type: materialControlLocations.type,
    })
    .from(materialControlLocations)
    .where(eq(materialControlLocations.id, targetLocationId))
    .limit(1);
  if (!location) fail("NOT_FOUND", "Địa điểm đích không tồn tại.");
  if (location.projectId !== null && location.projectId !== projectId) {
    fail("BAD_REQUEST", "Địa điểm đích không thuộc dự án của kế hoạch.");
  }
  if (
    location.type !== "warehouse" &&
    location.type !== "site" &&
    location.type !== "zone"
  ) {
    fail(
      "BAD_REQUEST",
      "Nhu cầu vật tư phải trỏ đến kho, công trường hoặc khu vực.",
    );
  }
}

async function validatePlanAndLocation(
  database: QueryDb,
  planId: number,
  targetLocationId: number | null,
): Promise<PlanRow> {
  const plan = await planById(database, planId);
  await validateTargetLocation(database, plan.projectId, targetLocationId);
  return plan;
}

export async function createRequirement(
  input: CreateRequirementInput,
  database: AppDb = db,
): Promise<RequirementView> {
  validateRequirementQuantity(input.quantity);
  const requiredAt = validateRequirementDate(input.requiredAt);
  const targetLocationId = input.targetLocationId ?? null;
  if (targetLocationId !== null && !positiveInteger(targetLocationId)) {
    fail("BAD_REQUEST", "Địa điểm đích không hợp lệ.");
  }
  const materialId = input.materialId ?? null;
  if (materialId !== null && !positiveInteger(materialId)) {
    fail("BAD_REQUEST", "Mã vật tư phải là số dương hoặc null.");
  }
  try {
    const row = await database.transaction(async (tx) => {
      const plan = await validatePlanAndLocation(
        tx,
        input.planId,
        targetLocationId,
      );
      const catalog =
        materialId === null ? null : await materialById(tx, materialId);
      const snapshot = captureRequirementSnapshot(input, catalog);
      const [created] = await tx
        .insert(materialControlRequirements)
        .values({
          planId: plan.id,
          materialId: snapshot.materialId,
          materialName: snapshot.materialName,
          specText: snapshot.specText,
          unit: snapshot.unit,
          quantity: input.quantity,
          requiredAt,
          targetLocationId,
          status: input.status ?? "open",
          notes: input.notes?.trim() ?? "",
        })
        .returning();
      if (!created) fail("BAD_REQUEST", "Không tạo được nhu cầu vật tư.");
      return created;
    });
    return requirementView(row);
  } catch (error) {
    if (error instanceof MaterialControlServiceError) throw error;
    throw error;
  }
}

export async function getRequirement(
  id: number,
  database: AppDb = db,
): Promise<RequirementView> {
  const [row] = await database
    .select()
    .from(materialControlRequirements)
    .where(eq(materialControlRequirements.id, id))
    .limit(1);
  if (!row) fail("NOT_FOUND", "Nhu cầu vật tư không tồn tại.");
  return requirementView(row);
}

export async function listRequirements(
  input: ListRequirementsInput,
  database: AppDb = db,
): Promise<readonly RequirementView[]> {
  const keyword = input.keyword?.trim();
  const rows = await database
    .select()
    .from(materialControlRequirements)
    .where(
      and(
        eq(materialControlRequirements.planId, input.planId),
        input.status
          ? eq(materialControlRequirements.status, input.status)
          : undefined,
        keyword
          ? or(
              ilike(materialControlRequirements.materialName, `%${keyword}%`),
              ilike(materialControlRequirements.specText, `%${keyword}%`),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(materialControlRequirements.requiredAt),
      asc(materialControlRequirements.id),
    );
  return rows.map(requirementView);
}

export async function updateRequirement(
  input: UpdateRequirementInput,
  database: AppDb = db,
): Promise<RequirementView> {
  if (input.quantity !== undefined) validateRequirementQuantity(input.quantity);
  const requiredAt =
    input.requiredAt === undefined
      ? undefined
      : validateRequirementDate(input.requiredAt);
  if (
    input.targetLocationId !== undefined &&
    input.targetLocationId !== null &&
    !positiveInteger(input.targetLocationId)
  ) {
    fail("BAD_REQUEST", "Địa điểm đích không hợp lệ.");
  }
  if (
    input.materialId !== undefined &&
    input.materialId !== null &&
    !positiveInteger(input.materialId)
  ) {
    fail("BAD_REQUEST", "Mã vật tư phải là số dương hoặc null.");
  }
  return database.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(materialControlRequirements)
      .where(eq(materialControlRequirements.id, input.id))
      .limit(1)
      .for("update");
    if (!current) fail("NOT_FOUND", "Nhu cầu vật tư không tồn tại.");
    const targetLocationId =
      input.targetLocationId === undefined
        ? current.targetLocationId
        : input.targetLocationId;
    const plan = await validatePlanAndLocation(
      tx,
      current.planId,
      targetLocationId,
    );
    const materialId =
      input.materialId === undefined ? current.materialId : input.materialId;
    const catalog =
      materialId === null ? null : await materialById(tx, materialId);
    // The name, specification, and unit are an immutable requirement
    // snapshot. A later catalog link only changes materialId.
    if (catalog && materialId !== current.materialId) {
      parseMaterialSnapshot({
        materialId,
        materialName: current.materialName,
        specText: current.specText,
        unit: current.unit,
      });
    }
    const snapshot = {
      materialId,
      materialName: current.materialName,
      specText: current.specText,
      unit: current.unit,
    } satisfies MaterialSnapshot;
    const [updated] = await tx
      .update(materialControlRequirements)
      .set({
        planId: plan.id,
        materialId: snapshot.materialId,
        materialName: snapshot.materialName,
        specText: snapshot.specText,
        unit: snapshot.unit,
        quantity: input.quantity ?? Number(current.quantity),
        requiredAt: requiredAt === undefined ? current.requiredAt : requiredAt,
        targetLocationId,
        status: input.status ?? current.status,
        notes: input.notes === undefined ? current.notes : input.notes.trim(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialControlRequirements.id, input.id))
      .returning();
    if (!updated) fail("NOT_FOUND", "Nhu cầu vật tư không tồn tại.");
    return requirementView(updated);
  });
}

export async function deleteRequirement(
  id: number,
  database: AppDb = db,
): Promise<{ id: number }> {
  return database.transaction(async (tx) => {
    const [cancelled] = await tx
      .update(materialControlRequirements)
      .set({
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialControlRequirements.id, id))
      .returning({ id: materialControlRequirements.id });
    if (!cancelled) fail("NOT_FOUND", "Nhu cầu vật tư không tồn tại.");
    return cancelled;
  });
}

export async function getPlanSummary(
  planId: number,
  database: AppDb = db,
): Promise<PlanSummaryView> {
  await planById(database, planId);
  const requirements = await listRequirements({ planId }, database);
  return {
    planId,
    requirementCount: requirements.length,
    openRequirementCount: requirements.filter(
      (requirement) =>
        requirement.status !== "fulfilled" &&
        requirement.status !== "cancelled",
    ).length,
    fulfilledRequirementCount: requirements.filter(
      (requirement) => requirement.status === "fulfilled",
    ).length,
    totalRequiredQuantity: requirements.reduce(
      (total, requirement) => total + requirement.quantity,
      0,
    ),
    requirements,
  };
}
