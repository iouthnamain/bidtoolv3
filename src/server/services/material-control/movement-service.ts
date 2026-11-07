import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "~/server/db";
import {
  materialControlLocations,
  materialControlRequirements,
  materialControlStockMovements,
  materials,
  materialControlPlans,
} from "~/server/db/schema";
import {
  assertMaterialMatch,
  calculateOnHandAtLocation,
  createTransferPair,
  parseMaterialSnapshot,
  parseMovementInput,
  validateMovementInput,
} from "./quantity-formulas";
import type {
  MaterialControlMovementType,
  MaterialSnapshot,
  MovementInput,
} from "./types";
import { captureRequirementSnapshot } from "./requirement-service";
import { MaterialControlServiceError } from "./project-service";

type AppDb = typeof db;
type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
type DbHandle = AppDb | AppTx;
type MovementRow = typeof materialControlStockMovements.$inferSelect;

export type RecordMovementInput = Readonly<{
  projectId?: number | null;
  movementType: MaterialControlMovementType;
  quantity: number;
  sourceLocationId?: number | null;
  destinationLocationId?: number | null;
  requirementId?: number | null;
  shipmentId?: number | null;
  reservationId?: number | null;
  materialId?: number | null;
  materialName?: string;
  specText?: string;
  unit?: string;
  occurredAt?: string | Date | null;
  reversalOfId?: number | null;
  reference?: string | null;
  notes?: string;
  explicitAdjustment?: boolean;
}>;

export type MovementView = Readonly<{
  id: number;
  projectId: number | null;
  movementType: MaterialControlMovementType;
  sourceLocationId: number | null;
  destinationLocationId: number | null;
  shipmentId: number | null;
  reservationId: number | null;
  requirementId: number | null;
  material: MaterialSnapshot;
  quantity: number;
  occurredAt: string;
  reversalOfId: number | null;
  reference: string | null;
  notes: string;
}>;

function fail(
  code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST",
  message: string,
): never {
  throw new MaterialControlServiceError(code, message);
}

function positiveId(value: number | null | undefined): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Number.isInteger(value) &&
    value > 0
  );
}

function normalizeDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return new Date().toISOString();
  }
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime()))
    fail("BAD_REQUEST", "Ngày phát sinh không hợp lệ.");
  return date.toISOString();
}

function normalizeMovementRow(row: MovementRow): MovementInput {
  return {
    materialId: row.materialId,
    materialName: row.materialName,
    specText: row.specText,
    unit: row.unit,
    movementType: row.movementType,
    quantity: Number(row.quantity),
    sourceLocationId: row.sourceLocationId,
    destinationLocationId: row.destinationLocationId,
    requirementId: row.requirementId,
    shipmentId: row.shipmentId,
    reversalOfId: row.reversalOfId,
    pairId: null,
    explicitAdjustment: row.explicitAdjustment,
  };
}

function movementView(row: MovementRow): MovementView {
  return {
    id: row.id,
    projectId: row.projectId,
    movementType: row.movementType,
    sourceLocationId: row.sourceLocationId,
    destinationLocationId: row.destinationLocationId,
    shipmentId: row.shipmentId,
    reservationId: row.reservationId,
    requirementId: row.requirementId,
    material: {
      materialId: row.materialId,
      materialName: row.materialName,
      specText: row.specText,
      unit: row.unit,
    },
    quantity: Number(row.quantity),
    occurredAt: row.occurredAt,
    reversalOfId: row.reversalOfId,
    reference: row.reference,
    notes: row.notes,
  };
}

async function requirementContext(tx: DbHandle, requirementId: number) {
  const [row] = await tx
    .select({
      requirement: materialControlRequirements,
      projectId: materialControlPlans.projectId,
    })
    .from(materialControlRequirements)
    .innerJoin(
      materialControlPlans,
      eq(materialControlPlans.id, materialControlRequirements.planId),
    )
    .where(eq(materialControlRequirements.id, requirementId))
    .limit(1);
  if (!row) fail("NOT_FOUND", "Nhu cầu vật tư không tồn tại.");
  return row;
}

async function resolveSnapshot(
  tx: DbHandle,
  input: Pick<
    RecordMovementInput,
    "materialId" | "materialName" | "specText" | "unit"
  >,
  requirement:
    | Awaited<ReturnType<typeof requirementContext>>["requirement"]
    | null,
): Promise<MaterialSnapshot> {
  if (
    requirement &&
    input.materialId === undefined &&
    input.materialName === undefined
  ) {
    return {
      materialId: requirement.materialId,
      materialName: requirement.materialName,
      specText: requirement.specText,
      unit: requirement.unit,
    };
  }
  const materialId = input.materialId ?? requirement?.materialId ?? null;
  let catalog: typeof materials.$inferSelect | null = null;
  if (materialId !== null) {
    const [material] = await tx
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)))
      .limit(1);
    if (!material) fail("NOT_FOUND", "Vật tư catalog không tồn tại.");
    catalog = material;
  }
  const snapshot = captureRequirementSnapshot(
    {
      materialId,
      materialName: input.materialName ?? requirement?.materialName,
      specText: input.specText ?? requirement?.specText,
      unit: input.unit ?? requirement?.unit,
    },
    catalog,
  );
  if (requirement) {
    assertMaterialMatch(requirement, snapshot, "Nhu cầu và phát sinh kho");
  }
  return snapshot;
}

async function ensureLocations(
  tx: DbHandle,
  projectId: number | null,
  locationIds: readonly (number | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(locationIds.filter(positiveId))];
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      id: materialControlLocations.id,
      projectId: materialControlLocations.projectId,
    })
    .from(materialControlLocations)
    .where(inArray(materialControlLocations.id, ids));
  if (rows.length !== ids.length)
    fail("NOT_FOUND", "Địa điểm phát sinh không tồn tại.");
  if (
    rows.some((row) => row.projectId !== null && row.projectId !== projectId)
  ) {
    fail("BAD_REQUEST", "Địa điểm phát sinh không thuộc dự án.");
  }
}

async function lockLocations(
  tx: DbHandle,
  locationIds: readonly (number | null)[],
) {
  const ids = [...new Set(locationIds.filter(positiveId))];
  if (ids.length === 0) return;
  await tx
    .select({ id: materialControlLocations.id })
    .from(materialControlLocations)
    .where(inArray(materialControlLocations.id, ids))
    .for("update");
}

async function existingMovements(
  tx: DbHandle,
  snapshot: MaterialSnapshot,
): Promise<MovementInput[]> {
  const rows = await tx
    .select()
    .from(materialControlStockMovements)
    .where(
      snapshot.materialId === null
        ? and(
            isNull(materialControlStockMovements.materialId),
            eq(
              materialControlStockMovements.materialName,
              snapshot.materialName,
            ),
            eq(materialControlStockMovements.specText, snapshot.specText),
            eq(materialControlStockMovements.unit, snapshot.unit),
          )
        : eq(materialControlStockMovements.materialId, snapshot.materialId),
    );
  return rows.map(normalizeMovementRow);
}

async function insertMovement(
  tx: DbHandle,
  input: RecordMovementInput,
): Promise<MovementView> {
  const requirementId = input.requirementId ?? null;
  const context =
    requirementId === null ? null : await requirementContext(tx, requirementId);
  const projectId = input.projectId ?? context?.projectId ?? null;
  if (
    input.projectId !== undefined &&
    context &&
    input.projectId !== context.projectId
  ) {
    fail("BAD_REQUEST", "Phát sinh không thuộc dự án của nhu cầu.");
  }
  const snapshot = await resolveSnapshot(
    tx,
    input,
    context?.requirement ?? null,
  );
  const sourceLocationId = input.sourceLocationId ?? null;
  const destinationLocationId = input.destinationLocationId ?? null;
  const movement: MovementInput = {
    ...snapshot,
    movementType: input.movementType,
    quantity: input.quantity,
    sourceLocationId,
    destinationLocationId,
    requirementId,
    shipmentId: input.shipmentId ?? null,
    reversalOfId: input.reversalOfId ?? null,
    pairId: null,
    explicitAdjustment: input.explicitAdjustment === true,
  };
  validateMovementInput(movement);
  await ensureLocations(tx, projectId, [
    sourceLocationId,
    destinationLocationId,
  ]);
  await lockLocations(tx, [sourceLocationId, destinationLocationId]);
  const current = await existingMovements(tx, snapshot);
  for (const locationId of [sourceLocationId, destinationLocationId]) {
    if (locationId === null) continue;
    try {
      calculateOnHandAtLocation([...current, movement], locationId, snapshot);
    } catch (error) {
      if (error instanceof Error) fail("CONFLICT", error.message);
      throw error;
    }
  }
  const [row] = await tx
    .insert(materialControlStockMovements)
    .values({
      projectId,
      movementType: input.movementType,
      sourceLocationId,
      destinationLocationId,
      shipmentId: input.shipmentId ?? null,
      reservationId: input.reservationId ?? null,
      requirementId,
      materialId: snapshot.materialId,
      materialName: snapshot.materialName,
      specText: snapshot.specText,
      unit: snapshot.unit,
      quantity: input.quantity,
      explicitAdjustment: input.explicitAdjustment === true,
      occurredAt: normalizeDate(input.occurredAt),
      reversalOfId: input.reversalOfId ?? null,
      reference: input.reference?.trim() ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  if (!row) fail("BAD_REQUEST", "Không ghi được phát sinh kho.");
  return movementView(row);
}

export async function recordMovement(
  input: RecordMovementInput,
  database: AppDb = db,
): Promise<MovementView> {
  return database.transaction((tx) => insertMovement(tx, input));
}

export type TransferMovementInput = Readonly<{
  projectId?: number | null;
  requirementId?: number | null;
  materialId?: number | null;
  materialName?: string;
  specText?: string;
  unit?: string;
  quantity: number;
  sourceLocationId: number;
  destinationLocationId: number;
  occurredAt?: string | Date | null;
  reference?: string | null;
  notes?: string;
}>;

export async function recordTransfer(
  input: TransferMovementInput,
  database: AppDb = db,
): Promise<readonly [MovementView, MovementView]> {
  return database.transaction(async (tx) => {
    const requirement = input.requirementId
      ? await requirementContext(tx, input.requirementId)
      : null;
    const snapshot = await resolveSnapshot(
      tx,
      input,
      requirement?.requirement ?? null,
    );
    const pair = createTransferPair({
      ...snapshot,
      quantity: input.quantity,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      requirementId: input.requirementId ?? null,
      pairId: randomUUID(),
    });
    const projectId = input.projectId ?? requirement?.projectId ?? null;
    await ensureLocations(tx, projectId, [
      input.sourceLocationId,
      input.destinationLocationId,
    ]);
    await lockLocations(tx, [
      input.sourceLocationId,
      input.destinationLocationId,
    ]);
    const current = await existingMovements(tx, snapshot);
    try {
      calculateOnHandAtLocation(
        [...current, pair[0]],
        input.sourceLocationId,
        snapshot,
      );
    } catch (error) {
      if (error instanceof Error) fail("CONFLICT", error.message);
      throw error;
    }
    const values = pair.map((movement) => ({
      projectId,
      movementType: movement.movementType,
      sourceLocationId: movement.sourceLocationId,
      destinationLocationId: movement.destinationLocationId,
      shipmentId: null,
      reservationId: null,
      requirementId: movement.requirementId ?? null,
      materialId: snapshot.materialId,
      materialName: snapshot.materialName,
      specText: snapshot.specText,
      unit: snapshot.unit,
      quantity: movement.quantity,
      explicitAdjustment: false,
      occurredAt: normalizeDate(input.occurredAt),
      reversalOfId: null,
      reference: input.reference?.trim() ?? null,
      notes: input.notes?.trim() ?? "",
    }));
    const rows = await tx
      .insert(materialControlStockMovements)
      .values(values)
      .returning();
    if (rows.length !== 2) fail("BAD_REQUEST", "Không ghi đủ cặp chuyển kho.");
    return [movementView(rows[0]!), movementView(rows[1]!)] as const;
  });
}

export async function reverseMovement(
  movementId: number,
  database: AppDb = db,
): Promise<MovementView> {
  if (!positiveId(movementId))
    fail("BAD_REQUEST", "Mã phát sinh không hợp lệ.");
  return database.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(materialControlStockMovements)
      .where(eq(materialControlStockMovements.id, movementId))
      .limit(1)
      .for("update");
    if (!original) fail("NOT_FOUND", "Phát sinh kho không tồn tại.");
    if (original.movementType === "reversal") {
      fail("BAD_REQUEST", "Không thể đảo ngược một phát sinh đảo ngược.");
    }
    const [existing] = await tx
      .select({ id: materialControlStockMovements.id })
      .from(materialControlStockMovements)
      .where(eq(materialControlStockMovements.reversalOfId, original.id))
      .limit(1);
    if (existing) fail("CONFLICT", "Phát sinh này đã được đảo ngược.");
    const location =
      original.sourceLocationId ?? original.destinationLocationId;
    if (location === null)
      fail("BAD_REQUEST", "Phát sinh không có địa điểm để đảo ngược.");
    const isAdjustment = original.movementType === "adjustment";
    const quantity = Math.abs(Number(original.quantity));
    const sourceLocationId = isAdjustment
      ? Number(original.quantity) < 0
        ? null
        : location
      : original.destinationLocationId;
    const destinationLocationId = isAdjustment
      ? Number(original.quantity) < 0
        ? location
        : null
      : original.sourceLocationId;
    return insertMovement(tx, {
      projectId: original.projectId,
      movementType: "reversal",
      quantity,
      sourceLocationId,
      destinationLocationId,
      requirementId: original.requirementId,
      shipmentId: original.shipmentId,
      reservationId: original.reservationId,
      materialId: original.materialId,
      materialName: original.materialName,
      specText: original.specText,
      unit: original.unit,
      occurredAt: new Date().toISOString(),
      reversalOfId: original.id,
      reference: original.reference,
      notes: `Đảo ngược phát sinh #${original.id}`,
    });
  });
}

export async function listMovements(
  input: { projectId?: number; materialId?: number; limit?: number } = {},
  database: AppDb = db,
): Promise<readonly MovementView[]> {
  const rows = await database
    .select()
    .from(materialControlStockMovements)
    .where(
      and(
        input.projectId === undefined
          ? undefined
          : eq(materialControlStockMovements.projectId, input.projectId),
        input.materialId === undefined
          ? undefined
          : eq(materialControlStockMovements.materialId, input.materialId),
      ),
    )
    .orderBy(materialControlStockMovements.occurredAt)
    .limit(input.limit ?? 500);
  return rows.map(movementView);
}

/** Keep the parser available to routers and tests without duplicating domain validation. */
export { parseMaterialSnapshot, parseMovementInput };
