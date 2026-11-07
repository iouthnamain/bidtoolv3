import { and, asc, eq, isNull, or } from "drizzle-orm";

import { db } from "~/server/db";
import {
  materialControlLocations,
  materialControlPlans,
  materialControlPurchaseCommitmentLines,
  materialControlPurchaseCommitments,
  materialControlRequirements,
  materialControlReservations,
  materialControlStockMovements,
  materials,
  materialControlProjects,
} from "~/server/db/schema";
import { calculateSharedAvailable } from "./quantity-formulas";
import { captureRequirementSnapshot } from "./requirement-service";
import type {
  MaterialControlPurchaseStatus,
  MaterialControlReservationStatus,
  MaterialSnapshot,
  MovementInput,
  ReservationState,
} from "./types";
import { MaterialControlServiceError } from "./project-service";

type AppDb = typeof db;
type DbHandle = AppDb | Parameters<Parameters<AppDb["transaction"]>[0]>[0];
type RequirementRow = typeof materialControlRequirements.$inferSelect;

export type PurchaseLineInput = Readonly<{
  requirementId?: number | null;
  materialId?: number | null;
  materialName?: string;
  specText?: string;
  unit?: string;
  quantity: number;
  unitPrice?: number | null;
  currency?: string;
  expectedAt?: string | Date | null;
  notes?: string;
}>;

export type CreatePurchaseInput = Readonly<{
  projectId: number;
  status?: MaterialControlPurchaseStatus;
  supplierName?: string | null;
  externalReference?: string | null;
  committedAt?: string | Date | null;
  expectedAt?: string | Date | null;
  notes?: string;
  lines: readonly PurchaseLineInput[];
}>;

export type PurchaseCommitmentView = Readonly<{
  id: number;
  projectId: number;
  status: MaterialControlPurchaseStatus;
  supplierName: string | null;
  externalReference: string | null;
  committedAt: string | null;
  expectedAt: string | null;
  notes: string;
  lines: readonly PurchaseLineView[];
}>;

export type PurchaseLineView = Readonly<{
  id: number;
  commitmentId: number;
  requirementId: number | null;
  material: MaterialSnapshot;
  quantity: number;
  unitPrice: number | null;
  currency: string;
  expectedAt: string | null;
  notes: string;
}>;

export type CreateReservationInput = Readonly<{
  projectId: number;
  requirementId?: number | null;
  locationId: number;
  materialId?: number | null;
  materialName?: string;
  specText?: string;
  unit?: string;
  quantity: number;
  expiresAt?: string | Date | null;
  notes?: string;
}>;

export type ReservationView = Readonly<{
  id: number;
  projectId: number;
  requirementId: number | null;
  locationId: number;
  material: MaterialSnapshot;
  quantity: number;
  status: MaterialControlReservationStatus;
  expiresAt: string | null;
  releasedAt: string | null;
  fulfilledAt: string | null;
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

function quantity(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("BAD_REQUEST", `${label} phải lớn hơn 0.`);
  }
  if ((value.toString().split(".")[1]?.length ?? 0) > 3) {
    fail("BAD_REQUEST", `${label} chỉ được có tối đa 3 chữ số thập phân.`);
  }
}

function dateValue(
  value: string | Date | null | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime()))
    fail("BAD_REQUEST", `${label} không hợp lệ.`);
  return date.toISOString();
}

async function projectExists(tx: DbHandle, projectId: number) {
  const [project] = await tx
    .select({ id: materialControlProjects.id })
    .from(materialControlProjects)
    .where(eq(materialControlProjects.id, projectId))
    .limit(1);
  if (!project) fail("NOT_FOUND", "Dự án không tồn tại.");
}

async function requirementWithProject(
  tx: DbHandle,
  requirementId: number,
): Promise<{ requirement: RequirementRow; projectId: number }> {
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

function snapshotFromRequirement(
  requirement: RequirementRow,
): MaterialSnapshot {
  return {
    materialId: requirement.materialId,
    materialName: requirement.materialName,
    specText: requirement.specText,
    unit: requirement.unit,
  };
}

async function resolveSnapshot(
  tx: DbHandle,
  input: {
    requirementId?: number | null;
    materialId?: number | null;
    materialName?: string;
    specText?: string;
    unit?: string;
  },
) {
  const context = input.requirementId
    ? await requirementWithProject(tx, input.requirementId)
    : null;
  const materialId =
    input.materialId ?? context?.requirement.materialId ?? null;
  let catalog: typeof materials.$inferSelect | null = null;
  if (materialId !== null) {
    const [row] = await tx
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)))
      .limit(1);
    if (!row) fail("NOT_FOUND", "Vật tư catalog không tồn tại.");
    catalog = row;
  }
  const snapshot = context
    ? snapshotFromRequirement(context.requirement)
    : captureRequirementSnapshot(
        {
          materialId,
          materialName: input.materialName,
          specText: input.specText,
          unit: input.unit,
        },
        catalog,
      );
  if (
    context &&
    input.materialId !== undefined &&
    input.materialId !== context.requirement.materialId
  ) {
    fail("BAD_REQUEST", "Dòng nghiệp vụ phải dùng đúng vật tư của nhu cầu.");
  }
  return { snapshot, projectId: context?.projectId ?? null };
}

function lineView(
  row: typeof materialControlPurchaseCommitmentLines.$inferSelect,
): PurchaseLineView {
  return {
    id: row.id,
    commitmentId: row.commitmentId,
    requirementId: row.requirementId,
    material: {
      materialId: row.materialId,
      materialName: row.materialName,
      specText: row.specText,
      unit: row.unit,
    },
    quantity: Number(row.quantity),
    unitPrice: row.unitPrice,
    currency: row.currency,
    expectedAt: row.expectedAt,
    notes: row.notes,
  };
}

async function commitmentView(
  tx: DbHandle,
  row: typeof materialControlPurchaseCommitments.$inferSelect,
): Promise<PurchaseCommitmentView> {
  const lines = await tx
    .select()
    .from(materialControlPurchaseCommitmentLines)
    .where(eq(materialControlPurchaseCommitmentLines.commitmentId, row.id))
    .orderBy(asc(materialControlPurchaseCommitmentLines.id));
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    supplierName: row.supplierName,
    externalReference: row.externalReference,
    committedAt: row.committedAt,
    expectedAt: row.expectedAt,
    notes: row.notes,
    lines: lines.map(lineView),
  };
}

export async function createPurchaseCommitment(
  input: CreatePurchaseInput,
  database: AppDb = db,
): Promise<PurchaseCommitmentView> {
  if (!positiveId(input.projectId)) fail("BAD_REQUEST", "Dự án không hợp lệ.");
  if (input.lines.length === 0)
    fail("BAD_REQUEST", "Đơn mua phải có ít nhất một dòng vật tư.");
  for (const line of input.lines) quantity(line.quantity, "Số lượng mua");
  return database.transaction(async (tx) => {
    await projectExists(tx, input.projectId);
    const committedAt = dateValue(input.committedAt, "Ngày cam kết");
    const expectedAt = dateValue(input.expectedAt, "Ngày dự kiến");
    const [commitment] = await tx
      .insert(materialControlPurchaseCommitments)
      .values({
        projectId: input.projectId,
        status: input.status ?? "draft",
        supplierName: input.supplierName?.trim() ?? null,
        externalReference: input.externalReference?.trim() ?? null,
        committedAt,
        expectedAt,
        notes: input.notes?.trim() ?? "",
      })
      .returning();
    if (!commitment) fail("BAD_REQUEST", "Không tạo được đơn mua.");
    const values = [];
    for (const line of input.lines) {
      const context = line.requirementId
        ? await requirementWithProject(tx, line.requirementId)
        : null;
      if (context && context.projectId !== input.projectId)
        fail("BAD_REQUEST", "Nhu cầu không thuộc dự án của đơn mua.");
      const { snapshot } = await resolveSnapshot(tx, line);
      values.push({
        commitmentId: commitment.id,
        requirementId: line.requirementId ?? null,
        materialId: snapshot.materialId,
        materialName: snapshot.materialName,
        specText: snapshot.specText,
        unit: snapshot.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? null,
        currency: line.currency?.trim() ?? "VND",
        expectedAt: dateValue(line.expectedAt, "Ngày dự kiến dòng mua"),
        notes: line.notes?.trim() ?? "",
      });
    }
    await tx.insert(materialControlPurchaseCommitmentLines).values(values);
    return commitmentView(tx, commitment);
  });
}

export async function getPurchaseCommitment(
  id: number,
  database: AppDb = db,
): Promise<PurchaseCommitmentView> {
  const [row] = await database
    .select()
    .from(materialControlPurchaseCommitments)
    .where(eq(materialControlPurchaseCommitments.id, id))
    .limit(1);
  if (!row) fail("NOT_FOUND", "Đơn mua không tồn tại.");
  return commitmentView(database, row);
}

function movementFromRow(
  row: typeof materialControlStockMovements.$inferSelect,
): MovementInput {
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

function reservationFromRow(
  row: typeof materialControlReservations.$inferSelect,
): ReservationState {
  return {
    materialId: row.materialId,
    materialName: row.materialName,
    specText: row.specText,
    unit: row.unit,
    id: row.id,
    locationId: row.locationId,
    quantity: Number(row.quantity),
    status: row.status,
    requirementId: row.requirementId,
  };
}

export async function createReservation(
  input: CreateReservationInput,
  database: AppDb = db,
): Promise<ReservationView> {
  quantity(input.quantity, "Số lượng giữ chỗ");
  return database.transaction(async (tx) => {
    await projectExists(tx, input.projectId);
    const [location] = await tx
      .select()
      .from(materialControlLocations)
      .where(eq(materialControlLocations.id, input.locationId))
      .limit(1)
      .for("update");
    if (!location) fail("NOT_FOUND", "Địa điểm không tồn tại.");
    if (location.projectId !== null && location.projectId !== input.projectId)
      fail("BAD_REQUEST", "Địa điểm không thuộc dự án.");
    const context = input.requirementId
      ? await requirementWithProject(tx, input.requirementId)
      : null;
    if (context && context.projectId !== input.projectId)
      fail("BAD_REQUEST", "Nhu cầu không thuộc dự án.");
    const { snapshot } = await resolveSnapshot(tx, input);
    const materialMovementCondition =
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
        : eq(materialControlStockMovements.materialId, snapshot.materialId);
    const materialReservationCondition =
      snapshot.materialId === null
        ? and(
            isNull(materialControlReservations.materialId),
            eq(materialControlReservations.materialName, snapshot.materialName),
            eq(materialControlReservations.specText, snapshot.specText),
            eq(materialControlReservations.unit, snapshot.unit),
          )
        : eq(materialControlReservations.materialId, snapshot.materialId);
    const movements = await tx
      .select()
      .from(materialControlStockMovements)
      .where(
        and(
          materialMovementCondition,
          or(
            eq(
              materialControlStockMovements.sourceLocationId,
              input.locationId,
            ),
            eq(
              materialControlStockMovements.destinationLocationId,
              input.locationId,
            ),
          ),
        ),
      );
    const reservations = await tx
      .select()
      .from(materialControlReservations)
      .where(
        and(
          eq(materialControlReservations.locationId, input.locationId),
          materialReservationCondition,
        ),
      )
      .for("update");
    const available = calculateSharedAvailable({
      movements: movements.map(movementFromRow),
      reservations: reservations.map(reservationFromRow),
      locationId: input.locationId,
      material: snapshot,
    });
    if (input.quantity > available)
      fail("CONFLICT", `Tồn khả dụng không đủ (còn ${available}).`);
    const [row] = await tx
      .insert(materialControlReservations)
      .values({
        projectId: input.projectId,
        requirementId: input.requirementId ?? null,
        locationId: input.locationId,
        materialId: snapshot.materialId,
        materialName: snapshot.materialName,
        specText: snapshot.specText,
        unit: snapshot.unit,
        quantity: input.quantity,
        status: "active",
        expiresAt: dateValue(input.expiresAt, "Ngày hết hạn giữ chỗ"),
        notes: input.notes?.trim() ?? "",
      })
      .returning();
    if (!row) fail("BAD_REQUEST", "Không tạo được giữ chỗ.");
    return reservationView(row);
  });
}

function reservationView(
  row: typeof materialControlReservations.$inferSelect,
): ReservationView {
  return {
    id: row.id,
    projectId: row.projectId,
    requirementId: row.requirementId,
    locationId: row.locationId,
    material: {
      materialId: row.materialId,
      materialName: row.materialName,
      specText: row.specText,
      unit: row.unit,
    },
    quantity: Number(row.quantity),
    status: row.status,
    expiresAt: row.expiresAt,
    releasedAt: row.releasedAt,
    fulfilledAt: row.fulfilledAt,
    notes: row.notes,
  };
}

export async function listReservations(
  input: { projectId?: number; status?: MaterialControlReservationStatus } = {},
  database: AppDb = db,
): Promise<readonly ReservationView[]> {
  const rows = await database
    .select()
    .from(materialControlReservations)
    .where(
      and(
        input.projectId === undefined
          ? undefined
          : eq(materialControlReservations.projectId, input.projectId),
        input.status === undefined
          ? undefined
          : eq(materialControlReservations.status, input.status),
      ),
    )
    .orderBy(asc(materialControlReservations.createdAt));
  return rows.map(reservationView);
}

export async function releaseReservation(
  id: number,
  status: Extract<
    MaterialControlReservationStatus,
    "released" | "fulfilled" | "cancelled"
  > = "released",
  database: AppDb = db,
): Promise<ReservationView> {
  return database.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(materialControlReservations)
      .where(eq(materialControlReservations.id, id))
      .limit(1)
      .for("update");
    if (!current) fail("NOT_FOUND", "Giữ chỗ không tồn tại.");
    if (current.status !== "active") fail("CONFLICT", "Giữ chỗ đã kết thúc.");
    const now = new Date().toISOString();
    const [updated] = await tx
      .update(materialControlReservations)
      .set({
        status,
        releasedAt:
          status === "released" || status === "cancelled"
            ? now
            : current.releasedAt,
        fulfilledAt: status === "fulfilled" ? now : current.fulfilledAt,
        updatedAt: now,
      })
      .where(eq(materialControlReservations.id, id))
      .returning();
    if (!updated) fail("NOT_FOUND", "Giữ chỗ không tồn tại.");
    return reservationView(updated);
  });
}
