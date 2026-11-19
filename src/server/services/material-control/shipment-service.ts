import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "~/server/db";
import {
  materialControlLocations,
  materialControlPlans,
  materialControlRequirements,
  materialControlShipmentLines,
  materialControlShipments,
} from "~/server/db/schema";
import { recordMovementInTransaction } from "./movement-service";
import {
  MaterialControlServiceError,
  normalizeOptionalDate,
} from "./project-service";
import type { MaterialSnapshot } from "./types";

type AppDb = typeof db;
type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
type ShipmentRow = typeof materialControlShipments.$inferSelect;
type ShipmentLineRow = typeof materialControlShipmentLines.$inferSelect;

export type ShipmentLineInput = Readonly<{
  requirementId?: number | null;
  materialId?: number | null;
  materialName?: string;
  specText?: string;
  unit?: string;
  quantity: number;
  notes?: string;
}>;

export type CreateShipmentInput = Readonly<{
  projectId: number;
  sourceLocationId: number;
  destinationLocationId: number;
  externalReference?: string | null;
  plannedShipAt?: string | Date | null;
  expectedArrivalAt?: string | Date | null;
  notes?: string;
  lines: readonly ShipmentLineInput[];
}>;

export type ShipmentView = Readonly<{
  id: number;
  projectId: number;
  sourceLocationId: number;
  destinationLocationId: number;
  status: ShipmentRow["status"];
  externalReference: string | null;
  plannedShipAt: string | null;
  shippedAt: string | null;
  expectedArrivalAt: string | null;
  receivedAt: string | null;
  notes: string;
  lines: readonly ShipmentLineView[];
}>;

export type ShipmentLineView = Readonly<{
  id: number;
  shipmentId: number;
  requirementId: number | null;
  material: MaterialSnapshot;
  quantity: number;
  receivedQuantity: number;
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

function quantity(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    fail("BAD_REQUEST", "Số lượng vận chuyển phải lớn hơn 0.");
  if (Number(value.toFixed(3)) !== value)
    fail("BAD_REQUEST", "Số lượng chỉ được có tối đa 3 chữ số thập phân.");
}

function dateValue(
  value: string | Date | null | undefined,
  label: string,
): string | null {
  return normalizeOptionalDate(value, label);
}

function snapshotFromRequirement(
  row: typeof materialControlRequirements.$inferSelect,
): MaterialSnapshot {
  return {
    materialId: row.materialId,
    materialName: row.materialName,
    specText: row.specText,
    unit: row.unit,
  };
}

async function projectAndLocations(
  tx: AppTx,
  input: {
    projectId: number;
    sourceLocationId: number;
    destinationLocationId: number;
  },
) {
  if (
    !positiveId(input.projectId) ||
    !positiveId(input.sourceLocationId) ||
    !positiveId(input.destinationLocationId)
  )
    fail("BAD_REQUEST", "Dự án và địa điểm phải là số dương.");
  if (input.sourceLocationId === input.destinationLocationId)
    fail("BAD_REQUEST", "Địa điểm đi và đến phải khác nhau.");
  const locations = await tx
    .select({
      id: materialControlLocations.id,
      projectId: materialControlLocations.projectId,
    })
    .from(materialControlLocations)
    .where(
      inArray(materialControlLocations.id, [
        input.sourceLocationId,
        input.destinationLocationId,
      ]),
    );
  if (locations.length !== 2)
    fail("NOT_FOUND", "Địa điểm vận chuyển không tồn tại.");
  if (
    locations.some(
      (location) =>
        location.projectId !== null && location.projectId !== input.projectId,
    )
  )
    fail("BAD_REQUEST", "Địa điểm vận chuyển không thuộc dự án.");
}

async function lineSnapshot(
  tx: AppTx,
  line: ShipmentLineInput,
  projectId: number,
): Promise<MaterialSnapshot> {
  if (line.requirementId === null || line.requirementId === undefined) {
    if (!line.materialName?.trim() || !line.unit?.trim())
      fail("BAD_REQUEST", "Dòng vận chuyển cần tên vật tư và đơn vị.");
    return {
      materialId: line.materialId ?? null,
      materialName: line.materialName.trim(),
      specText: line.specText?.trim() ?? "",
      unit: line.unit.trim(),
    };
  }
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
    .where(eq(materialControlRequirements.id, line.requirementId))
    .limit(1);
  if (!row) fail("NOT_FOUND", "Nhu cầu của dòng vận chuyển không tồn tại.");
  if (row.projectId !== projectId)
    fail("BAD_REQUEST", "Nhu cầu không thuộc dự án vận chuyển.");
  if (
    line.materialId !== undefined &&
    line.materialId !== row.requirement.materialId
  )
    fail(
      "BAD_REQUEST",
      "Dòng vận chuyển phải dùng đúng liên kết catalog của nhu cầu.",
    );
  return snapshotFromRequirement(row.requirement);
}

function lineView(row: ShipmentLineRow): ShipmentLineView {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    requirementId: row.requirementId,
    material: {
      materialId: row.materialId,
      materialName: row.materialName,
      specText: row.specText,
      unit: row.unit,
    },
    quantity: Number(row.quantity),
    receivedQuantity: Number(row.receivedQuantity),
    notes: row.notes,
  };
}

async function shipmentView(
  tx: AppDb | AppTx,
  row: ShipmentRow,
): Promise<ShipmentView> {
  const lines = await tx
    .select()
    .from(materialControlShipmentLines)
    .where(eq(materialControlShipmentLines.shipmentId, row.id))
    .orderBy(asc(materialControlShipmentLines.id));
  return {
    id: row.id,
    projectId: row.projectId,
    sourceLocationId: row.sourceLocationId,
    destinationLocationId: row.destinationLocationId,
    status: row.status,
    externalReference: row.externalReference,
    plannedShipAt: row.plannedShipAt,
    shippedAt: row.shippedAt,
    expectedArrivalAt: row.expectedArrivalAt,
    receivedAt: row.receivedAt,
    notes: row.notes,
    lines: lines.map(lineView),
  };
}

export async function createShipment(
  input: CreateShipmentInput,
  database: AppDb = db,
): Promise<ShipmentView> {
  if (input.lines.length === 0)
    fail("BAD_REQUEST", "Chuyến hàng cần ít nhất một dòng vật tư.");
  input.lines.forEach((line) => quantity(line.quantity));
  return database.transaction(async (tx) => {
    await projectAndLocations(tx, input);
    const plannedShipAt = dateValue(input.plannedShipAt, "Ngày dự kiến gửi");
    const expectedArrivalAt = dateValue(
      input.expectedArrivalAt,
      "Ngày dự kiến đến",
    );
    const [shipment] = await tx
      .insert(materialControlShipments)
      .values({
        projectId: input.projectId,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        status: "draft",
        externalReference: input.externalReference?.trim() ?? null,
        plannedShipAt,
        expectedArrivalAt,
        notes: input.notes?.trim() ?? "",
      })
      .returning();
    if (!shipment) fail("BAD_REQUEST", "Không tạo được chuyến hàng.");
    const values = [];
    for (const line of input.lines) {
      const snapshot = await lineSnapshot(tx, line, input.projectId);
      values.push({
        shipmentId: shipment.id,
        requirementId: line.requirementId ?? null,
        materialId: snapshot.materialId,
        materialName: snapshot.materialName,
        specText: snapshot.specText,
        unit: snapshot.unit,
        quantity: line.quantity,
        receivedQuantity: 0,
        notes: line.notes?.trim() ?? "",
      });
    }
    await tx.insert(materialControlShipmentLines).values(values);
    return shipmentView(tx, shipment);
  });
}

export async function getShipment(
  id: number,
  database: AppDb = db,
): Promise<ShipmentView> {
  const [row] = await database
    .select()
    .from(materialControlShipments)
    .where(eq(materialControlShipments.id, id))
    .limit(1);
  if (!row) fail("NOT_FOUND", "Chuyến hàng không tồn tại.");
  return shipmentView(database, row);
}

export async function dispatchShipment(
  id: number,
  database: AppDb = db,
): Promise<ShipmentView> {
  return database.transaction(async (tx) => {
    const [shipment] = await tx
      .select()
      .from(materialControlShipments)
      .where(eq(materialControlShipments.id, id))
      .limit(1)
      .for("update");
    if (!shipment) fail("NOT_FOUND", "Chuyến hàng không tồn tại.");
    if (shipment.status !== "draft" && shipment.status !== "ready")
      fail("CONFLICT", "Chuyến hàng không ở trạng thái có thể gửi.");
    const lines = await tx
      .select()
      .from(materialControlShipmentLines)
      .where(eq(materialControlShipmentLines.shipmentId, id))
      .orderBy(asc(materialControlShipmentLines.id));
    if (lines.length === 0)
      fail("BAD_REQUEST", "Chuyến hàng chưa có dòng vật tư.");
    for (const line of lines) {
      await recordMovementInTransaction(
        {
          projectId: shipment.projectId,
          movementType: "shipment",
          quantity: Number(line.quantity),
          sourceLocationId: shipment.sourceLocationId,
          destinationLocationId: null,
          requirementId: line.requirementId,
          shipmentId: shipment.id,
          materialId: line.materialId,
          materialName: line.materialName,
          specText: line.specText,
          unit: line.unit,
          occurredAt: new Date().toISOString(),
          notes: `Gửi chuyến hàng #${shipment.id}`,
        },
        tx,
      );
    }
    const [updated] = await tx
      .update(materialControlShipments)
      .set({
        status: "in_transit",
        shippedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(materialControlShipments.id, id))
      .returning();
    if (!updated) fail("NOT_FOUND", "Chuyến hàng không tồn tại.");
    return shipmentView(tx, updated);
  });
}

export async function receiveShipment(
  id: number,
  received: ReadonlyArray<{ lineId: number; quantity: number }>,
  database: AppDb = db,
): Promise<ShipmentView> {
  return database.transaction(async (tx) => {
    const [shipment] = await tx
      .select()
      .from(materialControlShipments)
      .where(eq(materialControlShipments.id, id))
      .limit(1)
      .for("update");
    if (!shipment) fail("NOT_FOUND", "Chuyến hàng không tồn tại.");
    if (
      shipment.status !== "in_transit" &&
      shipment.status !== "partially_received"
    )
      fail("CONFLICT", "Chuyến hàng chưa ở trạng thái đang vận chuyển.");
    const lines = await tx
      .select()
      .from(materialControlShipmentLines)
      .where(eq(materialControlShipmentLines.shipmentId, id))
      .orderBy(asc(materialControlShipmentLines.id));
    if (received.length === 0)
      fail("BAD_REQUEST", "Chọn ít nhất một dòng vật tư để nhận.");
    const requested = new Map(
      received.map((item) => [item.lineId, item.quantity]),
    );
    if (requested.size !== received.length)
      fail("BAD_REQUEST", "Mỗi dòng vật tư chỉ được chọn một lần.");
    const shipmentLineIds = new Set(lines.map((line) => line.id));
    if (received.some((item) => !shipmentLineIds.has(item.lineId)))
      fail("BAD_REQUEST", "Dòng vật tư không thuộc chuyến hàng này.");

    for (const line of lines) {
      const next = requested.get(line.id);
      if (next === undefined) continue;
      quantity(next);
      // Match PostgreSQL's three-decimal scale before comparing the total.
      const total = Number((line.receivedQuantity + next).toFixed(3));
      if (total > line.quantity)
        fail("BAD_REQUEST", "Số lượng nhận vượt quá số lượng gửi.");
      await recordMovementInTransaction(
        {
          projectId: shipment.projectId,
          movementType: "site_receipt",
          quantity: next,
          sourceLocationId: null,
          destinationLocationId: shipment.destinationLocationId,
          requirementId: line.requirementId,
          shipmentId: shipment.id,
          materialId: line.materialId,
          materialName: line.materialName,
          specText: line.specText,
          unit: line.unit,
          occurredAt: new Date().toISOString(),
          notes: `Nhận chuyến hàng #${shipment.id}`,
        },
        tx,
      );
      await tx
        .update(materialControlShipmentLines)
        .set({ receivedQuantity: total, updatedAt: new Date().toISOString() })
        .where(eq(materialControlShipmentLines.id, line.id));
    }
    const finalLines = await tx
      .select()
      .from(materialControlShipmentLines)
      .where(eq(materialControlShipmentLines.shipmentId, id));
    const allReceived = finalLines.every(
      (line) => Number(line.receivedQuantity) === Number(line.quantity),
    );
    const anyReceived = finalLines.some(
      (line) => Number(line.receivedQuantity) > 0,
    );
    const now = new Date().toISOString();
    const [updated] = await tx
      .update(materialControlShipments)
      .set({
        status: allReceived
          ? "received"
          : anyReceived
            ? "partially_received"
            : shipment.status,
        receivedAt: allReceived ? now : shipment.receivedAt,
        updatedAt: now,
      })
      .where(eq(materialControlShipments.id, id))
      .returning();
    if (!updated) fail("NOT_FOUND", "Chuyến hàng không tồn tại.");
    return shipmentView(tx, updated);
  });
}

export async function listShipments(
  input: { projectId?: number; status?: ShipmentRow["status"] } = {},
  database: AppDb = db,
): Promise<readonly ShipmentView[]> {
  const rows = await database
    .select()
    .from(materialControlShipments)
    .where(
      and(
        input.projectId === undefined
          ? undefined
          : eq(materialControlShipments.projectId, input.projectId),
        input.status === undefined
          ? undefined
          : eq(materialControlShipments.status, input.status),
      ),
    )
    .orderBy(asc(materialControlShipments.createdAt));
  return Promise.all(rows.map((row) => shipmentView(database, row)));
}
