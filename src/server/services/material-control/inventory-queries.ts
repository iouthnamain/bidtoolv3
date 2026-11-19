import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "~/server/db";
import {
  materialControlLocations,
  materialControlPlans,
  materialControlPurchaseCommitmentLines,
  materialControlPurchaseCommitments,
  materialControlRequirementAllocations,
  materialControlRequirements,
  materialControlReservations,
  materialControlShipmentLines,
  materialControlShipments,
  materialControlStockMovements,
  materialControlProjects,
} from "~/server/db/schema";
import {
  calculateRequirementQuantities,
  type RequirementMovement,
} from "~/server/services/material-control/quantity-formulas";
import type {
  MaterialSnapshot,
  MovementInput,
  PurchaseCommitmentLine,
  RequirementSnapshot,
  ReservationState,
  ShipmentLine,
} from "~/server/services/material-control/types";
import {
  MaterialControlServiceError,
  type PlanView,
} from "~/server/services/material-control/project-service";
import type { RequirementView } from "~/server/services/material-control/requirement-service";

type AppDb = typeof db;
type RequirementRow = typeof materialControlRequirements.$inferSelect;
type MovementRow = typeof materialControlStockMovements.$inferSelect;
type ReservationRow = typeof materialControlReservations.$inferSelect;
type ShipmentStatus = (typeof materialControlShipments.$inferSelect)["status"];

const dispatchedShipmentStatuses: readonly ShipmentStatus[] = [
  "in_transit",
  "partially_received",
  "received",
];
const destinationLocations = alias(materialControlLocations, "destination");

export type RequirementSummaryView = RequirementView;

export type PlanDetailView = Readonly<{
  plan: PlanView;
  requirements: readonly RequirementSummaryView[];
  totals: Readonly<{
    required: number;
    ordered: number;
    missingToBuy: number;
    shipped: number;
    received: number;
    inTransit: number;
    installed: number;
    remainingToInstall: number;
    siteOnHand: number;
    lateRequirements: number;
  }>;
}>;

export type StockBalanceView = Readonly<{
  locationId: number;
  material: MaterialSnapshot;
  onHand: number;
  reserved: number;
  available: number;
  oversubscribed: boolean;
}>;

export type ShortageView = Readonly<{
  requirement: RequirementSummaryView;
  shortage: number;
  late: boolean;
}>;

export type DashboardSummaryView = Readonly<{
  projects: Readonly<{ total: number; active: number }>;
  plans: Readonly<{ total: number; active: number }>;
  requirements: Readonly<{
    total: number;
    open: number;
    fulfilled: number;
    requiredQuantity: number;
    missingToBuy: number;
  }>;
  logistics: Readonly<{
    shipped: number;
    received: number;
    inTransit: number;
    installed: number;
  }>;
  shortages: Readonly<{ count: number; late: number }>;
  stock: Readonly<{
    locationCount: number;
    materialCount: number;
    available: number;
  }>;
}>;

type RequirementBundle = Readonly<{
  purchases: readonly PurchaseCommitmentLine[];
  shipments: readonly ShipmentLine[];
  movements: readonly RequirementMovement[];
  reservations: readonly ReservationState[];
}>;

function fail(
  code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST",
  message: string,
): never {
  throw new MaterialControlServiceError(code, message);
}

function materialFromRow(row: {
  materialId: number | null;
  materialName: string;
  specText: string;
  unit: string;
}): MaterialSnapshot {
  return {
    materialId: row.materialId,
    materialName: row.materialName,
    specText: row.specText,
    unit: row.unit,
  };
}

function movementFromRow(row: MovementRow): MovementInput {
  return {
    ...materialFromRow(row),
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

function reservationFromRow(row: ReservationRow): ReservationState {
  return {
    ...materialFromRow(row),
    id: row.id,
    locationId: row.locationId,
    quantity: Number(row.quantity),
    status: row.status,
    requirementId: row.requirementId,
  };
}

function requirementSnapshot(row: RequirementRow): RequirementSnapshot {
  return {
    ...materialFromRow(row),
    id: row.id,
    quantity: Number(row.quantity),
    requiredAt: row.requiredAt,
    targetLocationId: row.targetLocationId,
    status: row.status,
  };
}

function requirementView(
  row: RequirementRow,
  bundle: RequirementBundle,
  now: string | Date,
): RequirementSummaryView {
  const snapshot = requirementSnapshot(row);
  const summary = calculateRequirementQuantities({
    requirement: snapshot,
    purchaseCommitmentLines: bundle.purchases,
    shipmentLines: bundle.shipments,
    movements: bundle.movements,
    reservations: bundle.reservations,
    now,
  });
  return {
    id: row.id,
    planId: row.planId,
    material: materialFromRow(row),
    materialId: row.materialId,
    materialName: row.materialName,
    specText: row.specText,
    unit: row.unit,
    quantity: Number(row.quantity),
    requiredAt: row.requiredAt,
    targetLocationId: row.targetLocationId,
    status: row.status,
    notes: row.notes,
    summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function keyForMaterial(material: MaterialSnapshot): string {
  return [
    material.materialId ?? "provisional",
    material.materialName.trim().toLocaleLowerCase("en-US"),
    material.specText.trim().toLocaleLowerCase("en-US"),
    material.unit.trim().toLocaleLowerCase("en-US"),
  ].join("|");
}

function signedDelta(movement: MovementInput, locationId: number): number {
  if (movement.movementType === "adjustment") {
    const target = movement.destinationLocationId ?? movement.sourceLocationId;
    return target === locationId ? movement.quantity : 0;
  }
  let delta = 0;
  if (movement.sourceLocationId === locationId) delta -= movement.quantity;
  if (movement.destinationLocationId === locationId) delta += movement.quantity;
  return delta;
}

/** Pure aggregation used by the stock query and its fixture tests. */
export function aggregateStockBalances(
  movements: readonly MovementInput[],
  reservations: readonly ReservationState[],
): readonly StockBalanceView[] {
  const groups = new Map<
    string,
    {
      locationId: number;
      material: MaterialSnapshot;
      onHand: number;
      reserved: number;
    }
  >();
  const ensure = (locationId: number, material: MaterialSnapshot) => {
    const key = `${locationId}|${keyForMaterial(material)}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const created = { locationId, material, onHand: 0, reserved: 0 };
    groups.set(key, created);
    return created;
  };
  for (const movement of movements) {
    const material = materialFromRow(movement);
    for (const locationId of [
      movement.sourceLocationId,
      movement.destinationLocationId,
    ]) {
      if (locationId === null) continue;
      ensure(locationId, material).onHand += signedDelta(movement, locationId);
    }
  }
  for (const reservation of reservations) {
    ensure(reservation.locationId, materialFromRow(reservation)).reserved +=
      reservation.status === "active" ? reservation.quantity : 0;
  }
  return [...groups.values()]
    .map((group) => ({
      locationId: group.locationId,
      material: group.material,
      onHand: group.onHand,
      reserved: group.reserved,
      available: group.onHand - group.reserved,
      oversubscribed: group.onHand - group.reserved < 0,
    }))
    .sort(
      (left, right) =>
        left.locationId - right.locationId ||
        keyForMaterial(left.material).localeCompare(
          keyForMaterial(right.material),
        ),
    );
}

async function loadBundle(
  database: AppDb,
  requirements: readonly RequirementRow[],
  projectIds: readonly number[],
): Promise<ReadonlyMap<number, RequirementBundle>> {
  const requirementIds = requirements.map((row) => row.id);
  if (requirementIds.length === 0) return new Map();

  const [
    purchaseRows,
    allocationRows,
    shipmentRows,
    movementRows,
    reservationRows,
  ] = await Promise.all([
    database
      .select({
        line: materialControlPurchaseCommitmentLines,
        status: materialControlPurchaseCommitments.status,
      })
      .from(materialControlPurchaseCommitmentLines)
      .innerJoin(
        materialControlPurchaseCommitments,
        eq(
          materialControlPurchaseCommitments.id,
          materialControlPurchaseCommitmentLines.commitmentId,
        ),
      )
      .where(
        or(
          inArray(
            materialControlPurchaseCommitmentLines.requirementId,
            requirementIds,
          ),
          inArray(
            materialControlPurchaseCommitmentLines.id,
            database
              .select({
                id: materialControlRequirementAllocations.purchaseCommitmentLineId,
              })
              .from(materialControlRequirementAllocations)
              .where(
                inArray(
                  materialControlRequirementAllocations.requirementId,
                  requirementIds,
                ),
              ),
          ),
        ),
      ),
    database
      .select()
      .from(materialControlRequirementAllocations)
      .where(
        inArray(
          materialControlRequirementAllocations.requirementId,
          requirementIds,
        ),
      ),
    database
      .select({ line: materialControlShipmentLines })
      .from(materialControlShipmentLines)
      .innerJoin(
        materialControlShipments,
        eq(
          materialControlShipments.id,
          materialControlShipmentLines.shipmentId,
        ),
      )
      .where(
        and(
          inArray(materialControlShipmentLines.requirementId, requirementIds),
          inArray(materialControlShipments.status, dispatchedShipmentStatuses),
        ),
      ),
    database
      .select({
        movement: materialControlStockMovements,
        sourceLocationType: materialControlLocations.type,
        destinationLocationType: destinationLocations.type,
        shipmentStatus: materialControlShipments.status,
      })
      .from(materialControlStockMovements)
      .leftJoin(
        materialControlLocations,
        eq(
          materialControlLocations.id,
          materialControlStockMovements.sourceLocationId,
        ),
      )
      .leftJoin(
        destinationLocations,
        eq(
          destinationLocations.id,
          materialControlStockMovements.destinationLocationId,
        ),
      )
      .leftJoin(
        materialControlShipments,
        and(
          eq(
            materialControlShipments.id,
            materialControlStockMovements.shipmentId,
          ),
          eq(
            materialControlShipments.projectId,
            materialControlStockMovements.projectId,
          ),
        ),
      )
      .where(
        or(
          inArray(materialControlStockMovements.requirementId, requirementIds),
          inArray(materialControlStockMovements.projectId, projectIds),
          isNull(materialControlStockMovements.projectId),
        ),
      )
      .orderBy(
        asc(materialControlStockMovements.occurredAt),
        asc(materialControlStockMovements.id),
      ),
    database
      .select()
      .from(materialControlReservations)
      .where(inArray(materialControlReservations.projectId, projectIds)),
  ]);

  const movements: RequirementMovement[] = movementRows.map(
    ({
      movement,
      sourceLocationType,
      destinationLocationType,
      shipmentStatus,
    }) => ({
      ...movementFromRow(movement),
      shipmentId: shipmentStatus === null ? null : movement.shipmentId,
      sourceIsSiteOrZone:
        sourceLocationType === "site" || sourceLocationType === "zone",
      destinationIsSiteOrZone:
        destinationLocationType === "site" ||
        destinationLocationType === "zone",
      shipmentDispatched:
        shipmentStatus === null
          ? undefined
          : dispatchedShipmentStatuses.includes(shipmentStatus),
    }),
  );
  const allocationsByLine = new Map<number, typeof allocationRows>();
  for (const allocation of allocationRows) {
    if (allocation.purchaseCommitmentLineId === null) continue;
    const list =
      allocationsByLine.get(allocation.purchaseCommitmentLineId) ?? [];
    list.push(allocation);
    allocationsByLine.set(allocation.purchaseCommitmentLineId, list);
  }
  const bundleByRequirement = new Map<number, RequirementBundle>();
  for (const requirement of requirements) {
    const purchases: PurchaseCommitmentLine[] = [];
    for (const row of purchaseRows) {
      const allocations = allocationsByLine.get(row.line.id) ?? [];
      const relevant =
        row.line.requirementId === requirement.id ||
        allocations.some(
          (allocation) => allocation.requirementId === requirement.id,
        );
      if (!relevant) continue;
      purchases.push({
        ...materialFromRow(row.line),
        id: row.line.id,
        requirementId: row.line.requirementId,
        quantity: Number(row.line.quantity),
        status: row.status,
        allocatedQuantity:
          row.line.requirementId === requirement.id
            ? Number(row.line.quantity)
            : null,
        allocations: allocations.map((allocation) => ({
          requirementId: allocation.requirementId,
          quantity: Number(allocation.quantity),
        })),
      });
    }
    const shipments = shipmentRows
      .filter((row) => row.line.requirementId === requirement.id)
      .map(({ line }) => ({
        ...materialFromRow(line),
        id: line.id,
        shipmentId: line.shipmentId,
        requirementId: line.requirementId,
        quantity: Number(line.quantity),
        receivedQuantity: Number(line.receivedQuantity),
      }));
    const reservations = reservationRows.map(reservationFromRow);
    bundleByRequirement.set(requirement.id, {
      purchases,
      shipments,
      movements,
      reservations,
    });
  }
  return bundleByRequirement;
}

async function requirementRowsForPlans(
  database: AppDb,
  planIds: readonly number[],
): Promise<RequirementRow[]> {
  if (planIds.length === 0) return [];
  return database
    .select()
    .from(materialControlRequirements)
    .where(inArray(materialControlRequirements.planId, planIds))
    .orderBy(
      asc(materialControlRequirements.requiredAt),
      asc(materialControlRequirements.id),
    );
}

function totalsForRequirements(
  requirements: readonly RequirementSummaryView[],
) {
  return requirements.reduce(
    (totals, requirement) => ({
      required: totals.required + requirement.quantity,
      ordered: totals.ordered + requirement.summary.ordered,
      missingToBuy: totals.missingToBuy + requirement.summary.missingToBuy,
      shipped: totals.shipped + requirement.summary.shipped,
      received: totals.received + requirement.summary.received,
      inTransit: totals.inTransit + requirement.summary.inTransit,
      installed: totals.installed + requirement.summary.installed,
      remainingToInstall:
        totals.remainingToInstall + requirement.summary.remainingToInstall,
      siteOnHand: totals.siteOnHand + requirement.summary.siteOnHand,
      lateRequirements:
        totals.lateRequirements + (requirement.summary.late ? 1 : 0),
    }),
    {
      required: 0,
      ordered: 0,
      missingToBuy: 0,
      shipped: 0,
      received: 0,
      inTransit: 0,
      installed: 0,
      remainingToInstall: 0,
      siteOnHand: 0,
      lateRequirements: 0,
    },
  );
}

export async function getPlanDetail(
  planId: number,
  input: { now?: string | Date | null } = {},
  database: AppDb = db,
): Promise<PlanDetailView> {
  const [plan] = await database
    .select()
    .from(materialControlPlans)
    .where(eq(materialControlPlans.id, planId))
    .limit(1);
  if (!plan) fail("NOT_FOUND", "Kế hoạch không tồn tại.");
  const [project] = await database
    .select()
    .from(materialControlProjects)
    .where(eq(materialControlProjects.id, plan.projectId))
    .limit(1);
  if (!project) fail("NOT_FOUND", "Dự án của kế hoạch không tồn tại.");
  const rows = await requirementRowsForPlans(database, [plan.id]);
  const bundle = await loadBundle(database, rows, [project.id]);
  const now = input.now ?? new Date().toISOString();
  const requirements = rows.map((row) =>
    requirementView(
      row,
      bundle.get(row.id) ?? {
        purchases: [],
        shipments: [],
        movements: [],
        reservations: [],
      },
      now,
    ),
  );
  const totals = totalsForRequirements(requirements);
  return {
    plan: {
      id: plan.id,
      projectId: plan.projectId,
      name: plan.name,
      status: plan.status,
      plannedStartAt: plan.plannedStartAt,
      plannedEndAt: plan.plannedEndAt,
      notes: plan.notes,
      requirementCount: rows.length,
      totalRequiredQuantity: totals.required,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    },
    requirements,
    totals,
  };
}

export async function listPlanDetails(
  input: {
    projectId?: number;
    status?: "draft" | "active" | "completed" | "archived";
    now?: string | Date | null;
  } = {},
  database: AppDb = db,
): Promise<readonly PlanDetailView[]> {
  const plans = await database
    .select()
    .from(materialControlPlans)
    .where(
      and(
        input.projectId === undefined
          ? undefined
          : eq(materialControlPlans.projectId, input.projectId),
        input.status === undefined
          ? undefined
          : eq(materialControlPlans.status, input.status),
      ),
    )
    .orderBy(
      desc(materialControlPlans.updatedAt),
      asc(materialControlPlans.id),
    );
  const projectIds = [...new Set(plans.map((plan) => plan.projectId))];
  const rows = await requirementRowsForPlans(
    database,
    plans.map((plan) => plan.id),
  );
  const bundle = await loadBundle(database, rows, projectIds);
  const now = input.now ?? new Date().toISOString();
  const requirementsByPlan = new Map<number, RequirementSummaryView[]>();
  for (const row of rows) {
    const list = requirementsByPlan.get(row.planId) ?? [];
    list.push(
      requirementView(
        row,
        bundle.get(row.id) ?? {
          purchases: [],
          shipments: [],
          movements: [],
          reservations: [],
        },
        now,
      ),
    );
    requirementsByPlan.set(row.planId, list);
  }
  return plans.map((plan) => {
    const requirements = requirementsByPlan.get(plan.id) ?? [];
    const totals = totalsForRequirements(requirements);
    return {
      plan: {
        id: plan.id,
        projectId: plan.projectId,
        name: plan.name,
        status: plan.status,
        plannedStartAt: plan.plannedStartAt,
        plannedEndAt: plan.plannedEndAt,
        notes: plan.notes,
        requirementCount: requirements.length,
        totalRequiredQuantity: totals.required,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      },
      requirements,
      totals,
    };
  });
}

export async function listStockBalances(
  input: { projectId?: number; locationId?: number; materialId?: number } = {},
  database: AppDb = db,
): Promise<readonly StockBalanceView[]> {
  const [movements, reservations] = await Promise.all([
    database
      .select()
      .from(materialControlStockMovements)
      .where(
        and(
          input.projectId === undefined
            ? undefined
            : or(
                eq(materialControlStockMovements.projectId, input.projectId),
                isNull(materialControlStockMovements.projectId),
              ),
          input.materialId === undefined
            ? undefined
            : eq(materialControlStockMovements.materialId, input.materialId),
        ),
      ),
    database
      .select()
      .from(materialControlReservations)
      .where(
        and(
          input.projectId === undefined
            ? undefined
            : eq(materialControlReservations.projectId, input.projectId),
          input.materialId === undefined
            ? undefined
            : eq(materialControlReservations.materialId, input.materialId),
        ),
      ),
  ]);
  return aggregateStockBalances(
    movements.map(movementFromRow),
    reservations.map(reservationFromRow),
  ).filter(
    (row) =>
      input.locationId === undefined || row.locationId === input.locationId,
  );
}

export async function listShortages(
  input: {
    projectId?: number;
    lateOnly?: boolean;
    now?: string | Date | null;
  } = {},
  database: AppDb = db,
): Promise<readonly ShortageView[]> {
  const plans = await database
    .select({
      id: materialControlPlans.id,
      projectId: materialControlPlans.projectId,
    })
    .from(materialControlPlans)
    .where(
      input.projectId === undefined
        ? undefined
        : eq(materialControlPlans.projectId, input.projectId),
    );
  const rows = await requirementRowsForPlans(
    database,
    plans.map((plan) => plan.id),
  );
  const bundle = await loadBundle(database, rows, [
    ...new Set(plans.map((plan) => plan.projectId)),
  ]);
  const now = input.now ?? new Date().toISOString();
  return rows
    .map((row) =>
      requirementView(
        row,
        bundle.get(row.id) ?? {
          purchases: [],
          shipments: [],
          movements: [],
          reservations: [],
        },
        now,
      ),
    )
    .filter(
      (requirement) =>
        requirement.summary.missingToBuy > 0 || requirement.summary.late,
    )
    .filter((requirement) => !input.lateOnly || requirement.summary.late)
    .map((requirement) => ({
      requirement,
      shortage: requirement.summary.missingToBuy,
      late: requirement.summary.late,
    }));
}

export async function getDashboardSummary(
  input: { projectId?: number; now?: string | Date | null } = {},
  database: AppDb = db,
): Promise<DashboardSummaryView> {
  const [projects, plans] = await Promise.all([
    database
      .select()
      .from(materialControlProjects)
      .where(
        input.projectId === undefined
          ? undefined
          : eq(materialControlProjects.id, input.projectId),
      ),
    database
      .select()
      .from(materialControlPlans)
      .where(
        input.projectId === undefined
          ? undefined
          : eq(materialControlPlans.projectId, input.projectId),
      ),
  ]);
  const rows = await requirementRowsForPlans(
    database,
    plans.map((plan) => plan.id),
  );
  const bundle = await loadBundle(database, rows, [
    ...new Set(plans.map((plan) => plan.projectId)),
  ]);
  const now = input.now ?? new Date().toISOString();
  const requirements = rows.map((row) =>
    requirementView(
      row,
      bundle.get(row.id) ?? {
        purchases: [],
        shipments: [],
        movements: [],
        reservations: [],
      },
      now,
    ),
  );
  const totals = totalsForRequirements(requirements);
  const stock = await listStockBalances(
    { projectId: input.projectId },
    database,
  );
  return {
    projects: {
      total: projects.length,
      active: projects.filter((project) => project.status === "active").length,
    },
    plans: {
      total: plans.length,
      active: plans.filter((plan) => plan.status === "active").length,
    },
    requirements: {
      total: requirements.length,
      open: requirements.filter(
        (requirement) =>
          requirement.status !== "fulfilled" &&
          requirement.status !== "cancelled",
      ).length,
      fulfilled: requirements.filter(
        (requirement) => requirement.status === "fulfilled",
      ).length,
      requiredQuantity: totals.required,
      missingToBuy: totals.missingToBuy,
    },
    logistics: {
      shipped: totals.shipped,
      received: totals.received,
      inTransit: totals.inTransit,
      installed: totals.installed,
    },
    shortages: {
      count: requirements.filter(
        (requirement) => requirement.summary.missingToBuy > 0,
      ).length,
      late: requirements.filter((requirement) => requirement.summary.late)
        .length,
    },
    stock: {
      locationCount: new Set(stock.map((row) => row.locationId)).size,
      materialCount: new Set(stock.map((row) => keyForMaterial(row.material)))
        .size,
      available: stock.reduce((total, row) => total + row.available, 0),
    },
  };
}
