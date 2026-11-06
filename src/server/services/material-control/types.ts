/**
 * Pure domain types for material control.
 *
 * These types intentionally mirror the material-control snapshots without
 * importing the database schema. A snapshot is the operational record; a
 * nullable catalog link is only a reference and may change later.
 */

export const materialControlMovementTypes = [
  "receipt",
  "shipment",
  "site_receipt",
  "installation",
  "return",
  "waste",
  "transfer_out",
  "transfer_in",
  "adjustment",
  "reversal",
] as const;

export type MaterialControlMovementType =
  (typeof materialControlMovementTypes)[number];

export const materialControlReservationStatuses = [
  "active",
  "released",
  "fulfilled",
  "cancelled",
] as const;

export type MaterialControlReservationStatus =
  (typeof materialControlReservationStatuses)[number];

export const materialControlPurchaseStatuses = [
  "draft",
  "committed",
  "partially_received",
  "received",
  "cancelled",
] as const;

export type MaterialControlPurchaseStatus =
  (typeof materialControlPurchaseStatuses)[number];

export type MaterialControlRequirementStatus =
  | "open"
  | "partially_fulfilled"
  | "fulfilled"
  | "cancelled";

export type MaterialSnapshot = Readonly<{
  /** Nullable because provisional requirements are valid. */
  materialId: number | null;
  materialName: string;
  specText: string;
  unit: string;
}>;

/** The immutable material and quantity captured by a requirement. */
export type RequirementSnapshot = MaterialSnapshot &
  Readonly<{
    id: number;
    quantity: number;
    requiredAt: string | null;
    targetLocationId: number | null;
    status?: MaterialControlRequirementStatus;
  }>;

export type RequirementAllocation = Readonly<{
  requirementId: number;
  quantity: number;
}>;

/** A purchase line can be shared and explicitly allocated to requirements. */
export type PurchaseCommitmentLine = MaterialSnapshot &
  Readonly<{
    id?: number;
    requirementId?: number | null;
    quantity: number;
    allocatedQuantity?: number | null;
    allocations?: readonly RequirementAllocation[];
    status?: MaterialControlPurchaseStatus;
  }>;

/** Shipment quantities are separate from receipt quantities for partial receipts. */
export type ShipmentLine = MaterialSnapshot &
  Readonly<{
    id?: number;
    requirementId?: number | null;
    shipmentId?: number;
    quantity: number;
    receivedQuantity?: number;
    sourceLocationId?: number | null;
    destinationLocationId?: number | null;
  }>;

/**
 * An append-only stock movement. Regular movement quantities are positive.
 * Signed quantities are accepted only for explicit adjustment inputs.
 */
export type MovementInput = MaterialSnapshot &
  Readonly<{
    id?: number;
    movementType: MaterialControlMovementType;
    quantity: number;
    sourceLocationId: number | null;
    destinationLocationId: number | null;
    requirementId?: number | null;
    shipmentId?: number | null;
    pairId?: string | null;
    reversalOfId?: number | null;
    explicitAdjustment?: boolean;
  }>;

export type ReservationState = MaterialSnapshot &
  Readonly<{
    id?: number;
    locationId: number;
    quantity: number;
    status: MaterialControlReservationStatus;
    requirementId?: number | null;
  }>;

export type RequirementQuantitySummary = Readonly<{
  required: number;
  ordered: number;
  missingToBuy: number;
  shipped: number;
  received: number;
  inTransit: number;
  installed: number;
  remainingToInstall: number;
  siteOnHand: number;
  sharedAvailable: number | null;
  late: boolean;
}>;

export type RequirementQuantityInput = Readonly<{
  requirement: RequirementSnapshot;
  purchaseCommitmentLines?: readonly PurchaseCommitmentLine[];
  shipmentLines?: readonly ShipmentLine[];
  movements?: readonly MovementInput[];
  reservations?: readonly ReservationState[];
  now?: string | Date;
}>;

export type SharedAvailabilityInput = Readonly<{
  movements: readonly MovementInput[];
  reservations: readonly ReservationState[];
  locationId: number;
  material?: MaterialSnapshot;
}>;

export type TransferInput = MaterialSnapshot &
  Readonly<{
    quantity: number;
    sourceLocationId: number;
    destinationLocationId: number;
    requirementId?: number | null;
    pairId?: string | null;
  }>;

export type TransferPair = readonly [MovementInput, MovementInput];

export type MaterialControlErrorCode =
  | "INVALID_SNAPSHOT"
  | "INVALID_QUANTITY"
  | "UNIT_MISMATCH"
  | "MATERIAL_MISMATCH"
  | "INVALID_MOVEMENT"
  | "INVALID_TRANSFER"
  | "NEGATIVE_RESULT"
  | "INVALID_DATE";

export class MaterialControlDomainError extends Error {
  constructor(
    readonly code: MaterialControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MaterialControlDomainError";
  }
}
