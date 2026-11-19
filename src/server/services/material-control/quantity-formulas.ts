import {
  materialControlMovementTypes,
  materialControlPurchaseStatuses,
  materialControlReservationStatuses,
  type MaterialControlErrorCode,
  type MaterialControlMovementType,
  type MaterialSnapshot,
  type MovementInput,
  type PurchaseCommitmentLine,
  type RequirementQuantityInput,
  type RequirementSnapshot,
  type ReservationState,
  type ShipmentLine,
  type SharedAvailabilityInput,
  type TransferInput,
  type TransferPair,
} from "./types";
import { MaterialControlDomainError as DomainError } from "./types";

const movementTypeSet: ReadonlySet<string> = new Set(
  materialControlMovementTypes,
);
const purchaseStatusSet: ReadonlySet<string> = new Set(
  materialControlPurchaseStatuses,
);
const reservationStatusSet: ReadonlySet<string> = new Set(
  materialControlReservationStatuses,
);

export type RequirementMovement = MovementInput &
  Readonly<{
    sourceIsSiteOrZone?: boolean;
    destinationIsSiteOrZone?: boolean;
    shipmentDispatched?: boolean;
    hasUnmatchedShipmentLink?: boolean;
  }>;

type RequirementSummaryInput = RequirementQuantityInput &
  Readonly<{ movements?: readonly RequirementMovement[] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value > 0;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedUnit(unit: string): string {
  return unit.trim().toLocaleLowerCase("en-US");
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function sameMaterialIdentity(
  left: MaterialSnapshot,
  right: MaterialSnapshot,
): boolean {
  return (
    normalizedText(left.materialName) === normalizedText(right.materialName) &&
    normalizedText(left.specText) === normalizedText(right.specText)
  );
}

function domainError(code: MaterialControlErrorCode, message: string): never {
  throw new DomainError(code, message);
}

/** Parse and validate a material snapshot at an external boundary. */
export function parseMaterialSnapshot(value: unknown): MaterialSnapshot {
  if (!isRecord(value)) {
    return domainError(
      "INVALID_SNAPSHOT",
      "Material snapshot must be an object",
    );
  }

  const nested = value.material;
  const source = isRecord(nested) ? nested : value;
  const materialId = source.materialId;
  if (
    materialId !== null &&
    materialId !== undefined &&
    !positiveInteger(materialId)
  ) {
    return domainError(
      "INVALID_SNAPSHOT",
      "Material id must be a positive integer or null",
    );
  }
  if (
    !text(source.materialName) ||
    !text(source.specText) ||
    !text(source.unit)
  ) {
    return domainError(
      "INVALID_SNAPSHOT",
      "Material snapshots require a name, specification, and unit",
    );
  }

  return {
    materialId: materialId === undefined ? null : materialId,
    materialName: source.materialName.trim(),
    specText: source.specText.trim(),
    unit: source.unit.trim(),
  };
}

/** Keep the captured name/specification/unit while changing only the catalog link. */
export function withCatalogLink(
  snapshot: MaterialSnapshot,
  materialId: number | null,
): MaterialSnapshot {
  const parsed = parseMaterialSnapshot(snapshot);
  if (materialId !== null && !positiveInteger(materialId)) {
    return domainError(
      "INVALID_SNAPSHOT",
      "Material id must be a positive integer or null",
    );
  }
  return { ...parsed, materialId };
}

export function assertPositiveQuantity(
  value: unknown,
  label = "Quantity",
): asserts value is number {
  if (!finiteNumber(value) || value <= 0) {
    domainError(
      "INVALID_QUANTITY",
      `${label} must be a finite quantity greater than zero`,
    );
  }
}

function assertAdjustmentQuantity(
  value: unknown,
  label: string,
): asserts value is number {
  if (!finiteNumber(value) || value === 0) {
    domainError(
      "INVALID_QUANTITY",
      `${label} must be a finite, non-zero quantity`,
    );
  }
}

function assertUnitMatch(
  left: MaterialSnapshot,
  right: MaterialSnapshot,
  context: string,
): void {
  if (normalizedUnit(left.unit) !== normalizedUnit(right.unit)) {
    domainError("UNIT_MISMATCH", `${context} uses incompatible units`);
  }
}

/** Snapshot fields remain authoritative even if catalog links differ. */
export function assertMaterialMatch(
  left: MaterialSnapshot,
  right: MaterialSnapshot,
  context = "Material rows",
): void {
  const leftSnapshot = parseMaterialSnapshot(left);
  const rightSnapshot = parseMaterialSnapshot(right);
  assertUnitMatch(leftSnapshot, rightSnapshot, context);
  if (
    normalizedText(leftSnapshot.materialName) !==
      normalizedText(rightSnapshot.materialName) ||
    normalizedText(leftSnapshot.specText) !==
      normalizedText(rightSnapshot.specText)
  ) {
    domainError(
      "MATERIAL_MISMATCH",
      `${context} refer to different material snapshots`,
    );
  }
}

function assertMovementType(
  value: unknown,
): asserts value is MaterialControlMovementType {
  if (typeof value !== "string" || !movementTypeSet.has(value)) {
    domainError("INVALID_MOVEMENT", "Unknown material-control movement type");
  }
}

function hasLocation(value: number | null): boolean {
  return value !== null;
}

/** Validate direction, quantity, and location requirements for one movement. */
export function validateMovementInput(input: MovementInput): void {
  const snapshot = parseMaterialSnapshot(input);
  assertMovementType(input.movementType);

  if (
    input.movementType === "adjustment" &&
    input.explicitAdjustment === true
  ) {
    assertAdjustmentQuantity(input.quantity, "Adjustment quantity");
  } else {
    assertPositiveQuantity(input.quantity);
  }

  const source = input.sourceLocationId;
  const destination = input.destinationLocationId;
  if (source !== null && !positiveInteger(source)) {
    domainError(
      "INVALID_MOVEMENT",
      "Source location must be a positive integer or null",
    );
  }
  if (destination !== null && !positiveInteger(destination)) {
    domainError(
      "INVALID_MOVEMENT",
      "Destination location must be a positive integer or null",
    );
  }
  if (source !== null && destination !== null && source === destination) {
    domainError(
      "INVALID_MOVEMENT",
      "Source and destination locations must differ",
    );
  }

  switch (input.movementType) {
    case "receipt":
    case "site_receipt":
    case "return":
    case "transfer_in":
      if (!hasLocation(destination)) {
        domainError(
          "INVALID_MOVEMENT",
          `${input.movementType} requires a destination location`,
        );
      }
      break;
    case "shipment":
    case "installation":
    case "waste":
    case "transfer_out":
      if (!hasLocation(source)) {
        domainError(
          "INVALID_MOVEMENT",
          `${input.movementType} requires a source location`,
        );
      }
      break;
    case "adjustment":
      if (
        input.explicitAdjustment !== true ||
        (source === null && destination === null)
      ) {
        domainError(
          "INVALID_MOVEMENT",
          "Adjustments require an explicit flag and one location",
        );
      }
      if (source !== null && destination !== null) {
        domainError(
          "INVALID_MOVEMENT",
          "An adjustment can target only one location",
        );
      }
      break;
    case "reversal":
      if (
        input.reversalOfId === null ||
        input.reversalOfId === undefined ||
        !positiveInteger(input.reversalOfId)
      ) {
        domainError(
          "INVALID_MOVEMENT",
          "A reversal requires the original movement id",
        );
      }
      if (source === null && destination === null) {
        domainError(
          "INVALID_MOVEMENT",
          "A reversal requires a source or destination location",
        );
      }
      break;
    default: {
      const exhaustive: never = input.movementType;
      return exhaustive;
    }
  }

  if (
    input.requirementId !== undefined &&
    input.requirementId !== null &&
    !positiveInteger(input.requirementId)
  ) {
    domainError(
      "INVALID_MOVEMENT",
      "Requirement id must be a positive integer or null",
    );
  }
  if (
    input.shipmentId !== undefined &&
    input.shipmentId !== null &&
    !positiveInteger(input.shipmentId)
  ) {
    domainError(
      "INVALID_MOVEMENT",
      "Shipment id must be a positive integer or null",
    );
  }
  if (
    input.pairId !== undefined &&
    input.pairId !== null &&
    !text(input.pairId)
  ) {
    domainError(
      "INVALID_TRANSFER",
      "A movement pair id must be non-empty when supplied",
    );
  }
  void snapshot;
}

/** Parse a movement row supplied by a router or another external boundary. */
export function parseMovementInput(value: unknown): MovementInput {
  if (!isRecord(value)) {
    return domainError("INVALID_MOVEMENT", "Movement input must be an object");
  }
  const snapshot = parseMaterialSnapshot(value);
  const movementType = value.movementType;
  const sourceLocationId = value.sourceLocationId;
  const destinationLocationId = value.destinationLocationId;
  if (
    (sourceLocationId !== null &&
      sourceLocationId !== undefined &&
      !positiveInteger(sourceLocationId)) ||
    (destinationLocationId !== null &&
      destinationLocationId !== undefined &&
      !positiveInteger(destinationLocationId))
  ) {
    return domainError(
      "INVALID_MOVEMENT",
      "Movement locations must be positive integers or null",
    );
  }
  if (typeof movementType !== "string" || !movementTypeSet.has(movementType)) {
    return domainError(
      "INVALID_MOVEMENT",
      "Unknown material-control movement type",
    );
  }
  const quantity = value.quantity;
  if (!finiteNumber(quantity)) {
    return domainError("INVALID_QUANTITY", "Movement quantity must be finite");
  }
  const source = sourceLocationId ?? null;
  const destination = destinationLocationId ?? null;
  if (
    (source !== null && !positiveInteger(source)) ||
    (destination !== null && !positiveInteger(destination))
  ) {
    return domainError(
      "INVALID_MOVEMENT",
      "Movement locations must be positive integers or null",
    );
  }
  const optionalNumber = (key: string): number | null => {
    const candidate = value[key];
    if (candidate === undefined || candidate === null) return null;
    if (!finiteNumber(candidate)) {
      return domainError("INVALID_MOVEMENT", `${key} must be a number or null`);
    }
    return candidate;
  };
  const optionalText = (key: string): string | null => {
    const candidate = value[key];
    if (candidate === undefined || candidate === null) return null;
    if (!text(candidate))
      return domainError("INVALID_MOVEMENT", `${key} must be text or null`);
    return candidate;
  };
  const movement: MovementInput = {
    ...snapshot,
    movementType: movementType as MaterialControlMovementType,
    quantity,
    sourceLocationId: source,
    destinationLocationId: destination,
    requirementId: optionalNumber("requirementId"),
    shipmentId: optionalNumber("shipmentId"),
    pairId: optionalText("pairId"),
    reversalOfId: optionalNumber("reversalOfId"),
    explicitAdjustment: value.explicitAdjustment === true,
  };
  validateMovementInput(movement);
  return movement;
}

function assertLineStatus(status: string | undefined): void {
  if (status !== undefined && !purchaseStatusSet.has(status)) {
    domainError("INVALID_QUANTITY", "Unknown purchase commitment status");
  }
}

function assertReservationStatus(status: string): void {
  if (!reservationStatusSet.has(status)) {
    domainError("INVALID_QUANTITY", "Unknown reservation status");
  }
}

function requirementMatches(
  row: Readonly<{ requirementId?: number | null }>,
  requirementId: number,
): boolean {
  return row.requirementId === requirementId;
}

function validatePurchaseLine(line: PurchaseCommitmentLine): void {
  parseMaterialSnapshot(line);
  assertPositiveQuantity(line.quantity, "Purchase commitment quantity");
  assertLineStatus(line.status);
  if (line.allocatedQuantity !== undefined && line.allocatedQuantity !== null) {
    assertPositiveQuantity(
      line.allocatedQuantity,
      "Allocated purchase quantity",
    );
    if (line.allocatedQuantity > line.quantity) {
      domainError(
        "INVALID_QUANTITY",
        "Allocated purchase quantity exceeds the line quantity",
      );
    }
  }
  for (const allocation of line.allocations ?? []) {
    if (!positiveInteger(allocation.requirementId)) {
      domainError(
        "INVALID_QUANTITY",
        "Allocation requirement id must be positive",
      );
    }
    assertPositiveQuantity(
      allocation.quantity,
      "Requirement allocation quantity",
    );
    if (allocation.quantity > line.quantity) {
      domainError(
        "INVALID_QUANTITY",
        "Requirement allocation exceeds the line quantity",
      );
    }
  }
}

function allocatedPurchaseQuantity(
  line: PurchaseCommitmentLine,
  requirement?: RequirementSnapshot,
): number {
  validatePurchaseLine(line);
  if (line.status === "draft" || line.status === "cancelled") return 0;
  if (!requirement) return line.quantity;
  const requirementId = requirement.id;

  const allocations = line.allocations?.filter(
    (allocation) => allocation.requirementId === requirementId,
  );
  if (allocations && allocations.length > 0) {
    assertMaterialMatch(requirement, line, "Requirement and purchase lines");
    return allocations.reduce(
      (total, allocation) => total + allocation.quantity,
      0,
    );
  }
  if (!requirementMatches(line, requirementId)) return 0;
  assertMaterialMatch(requirement, line, "Requirement and purchase lines");
  return line.allocatedQuantity ?? line.quantity;
}

/** Quantity in non-cancelled purchase commitments allocated to a requirement. */
export function calculateOrdered(
  lines: readonly PurchaseCommitmentLine[],
  requirement?: RequirementSnapshot,
): number {
  return lines.reduce(
    (total, line) => total + allocatedPurchaseQuantity(line, requirement),
    0,
  );
}

export function calculateMissingToBuy(
  required: number,
  ordered: number,
): number {
  assertPositiveQuantity(required, "Required quantity");
  if (!finiteNumber(ordered) || ordered < 0) {
    domainError(
      "INVALID_QUANTITY",
      "Ordered quantity must be finite and non-negative",
    );
  }
  return Math.max(0, required - ordered);
}

function validateShipmentLine(line: ShipmentLine): void {
  parseMaterialSnapshot(line);
  assertPositiveQuantity(line.quantity, "Shipment quantity");
  const received = line.receivedQuantity ?? 0;
  if (!finiteNumber(received) || received < 0 || received > line.quantity) {
    domainError(
      "INVALID_QUANTITY",
      "Received quantity must be between zero and shipped quantity",
    );
  }
}

function matchingShipmentLines(
  lines: readonly ShipmentLine[],
  requirement?: RequirementSnapshot,
): readonly ShipmentLine[] {
  return lines.filter((line) => {
    validateShipmentLine(line);
    if (requirement) {
      if (!requirementMatches(line, requirement.id)) return false;
      assertMaterialMatch(requirement, line, "Requirement and shipment lines");
    }
    return true;
  });
}

function matchingShipmentMovements(
  movements: readonly RequirementMovement[],
  lines: readonly ShipmentLine[],
  movementType: "shipment" | "site_receipt",
  requirement?: RequirementSnapshot,
): readonly RequirementMovement[] {
  const shipmentIds = new Set(lines.map((line) => line.shipmentId ?? null));
  return movements.filter((movement) => {
    if (
      movement.movementType !== movementType ||
      movement.shipmentDispatched === false ||
      shipmentIds.has(movement.shipmentId ?? null) ||
      (requirement && movement.requirementId !== requirement.id)
    )
      return false;
    validateMovementInput(movement);
    if (requirement) {
      assertMaterialMatch(
        requirement,
        movement,
        "Requirement and shipment movements",
      );
    }
    return true;
  });
}

/** Quantity dispatched, with line quantities taking precedence over their ledger rows. */
export function calculateShipped(
  shipmentLines: readonly ShipmentLine[],
  movements: readonly RequirementMovement[] = [],
  requirement?: RequirementSnapshot,
): number {
  const lines = matchingShipmentLines(shipmentLines, requirement);
  const ledgerShipments = matchingShipmentMovements(
    movements,
    lines,
    "shipment",
    requirement,
  );
  return (
    lines.reduce((total, line) => total + line.quantity, 0) +
    ledgerShipments.reduce((total, movement) => total + movement.quantity, 0)
  );
}

function calculateReceiptQuantities(
  shipmentLines: readonly ShipmentLine[],
  movements: readonly RequirementMovement[],
  requirement?: RequirementSnapshot,
) {
  const lines = matchingShipmentLines(shipmentLines, requirement);
  const ledgerReceipts = matchingShipmentMovements(
    movements,
    lines,
    "site_receipt",
    requirement,
  );
  let shipmentReceived = lines.reduce(
    (total, line) => total + (line.receivedQuantity ?? 0),
    0,
  );
  const ledgerShipments = matchingShipmentMovements(
    movements,
    lines,
    "shipment",
    requirement,
  );
  const shippedById = new Map<number, number>();
  for (const shipment of ledgerShipments) {
    if (shipment.shipmentId != null) {
      shippedById.set(
        shipment.shipmentId,
        (shippedById.get(shipment.shipmentId) ?? 0) + shipment.quantity,
      );
    }
  }
  let received = shipmentReceived;
  for (const receipt of ledgerReceipts) {
    received += receipt.quantity;
    if (receipt.shipmentId != null) {
      const remaining = shippedById.get(receipt.shipmentId) ?? 0;
      const settled = Math.min(remaining, receipt.quantity);
      shipmentReceived += settled;
      shippedById.set(receipt.shipmentId, remaining - settled);
    }
  }
  const unlinkedShipments = new Set(
    ledgerShipments.filter((movement) => movement.shipmentId == null),
  );
  const unlinkedReceipts = new Set(
    ledgerReceipts.filter(
      (movement) =>
        movement.shipmentId == null && !movement.hasUnmatchedShipmentLink,
    ),
  );
  let unlinkedInTransit = 0;
  let unlinkedReceived = 0;
  // The ledger arrives in event order. Receipts can settle earlier unlinked dispatches.
  for (const movement of movements) {
    if (unlinkedShipments.has(movement)) {
      unlinkedInTransit += movement.quantity;
    } else if (unlinkedReceipts.has(movement)) {
      const delivered = Math.min(movement.quantity, unlinkedInTransit);
      unlinkedReceived += delivered;
      unlinkedInTransit -= delivered;
    }
  }
  return {
    received,
    shipmentReceived: shipmentReceived + unlinkedReceived,
  };
}

/** Quantity received at the destination, including direct site receipts. */
export function calculateReceived(
  shipmentLines: readonly ShipmentLine[],
  movements: readonly RequirementMovement[] = [],
  requirement?: RequirementSnapshot,
): number {
  return calculateReceiptQuantities(shipmentLines, movements, requirement)
    .received;
}

export function calculateInTransit(shipped: number, received: number): number {
  if (
    !finiteNumber(shipped) ||
    shipped < 0 ||
    !finiteNumber(received) ||
    received < 0
  ) {
    domainError(
      "INVALID_QUANTITY",
      "Shipped and received quantities must be non-negative",
    );
  }
  if (received > shipped) {
    domainError(
      "NEGATIVE_RESULT",
      "Received quantity cannot exceed shipped quantity",
    );
  }
  return shipped - received;
}

/** Sum installation movements for a requirement. */
export function calculateInstalled(
  movements: readonly MovementInput[],
  requirement?: RequirementSnapshot,
): number {
  return movements
    .filter((movement) => {
      validateMovementInput(movement);
      if (movement.movementType !== "installation") return false;
      if (requirement) {
        if (movement.requirementId !== requirement.id) return false;
        assertMaterialMatch(
          requirement,
          movement,
          "Requirement and installation movements",
        );
      }
      return true;
    })
    .reduce((total, movement) => total + movement.quantity, 0);
}

export function calculateRemainingToInstall(
  required: number,
  installed: number,
): number {
  assertPositiveQuantity(required, "Required quantity");
  if (!finiteNumber(installed) || installed < 0) {
    domainError(
      "INVALID_QUANTITY",
      "Installed quantity must be finite and non-negative",
    );
  }
  return Math.max(0, required - installed);
}

function movementDeltaAtLocation(
  movement: MovementInput,
  locationId: number,
): number {
  validateMovementInput(movement);
  let delta = 0;
  if (movement.movementType === "adjustment") {
    const adjustmentLocation =
      movement.destinationLocationId ?? movement.sourceLocationId;
    return adjustmentLocation === locationId ? movement.quantity : 0;
  }
  if (movement.sourceLocationId === locationId) delta -= movement.quantity;
  if (movement.destinationLocationId === locationId) delta += movement.quantity;
  return delta;
}

function movementDeltaForSite(movement: RequirementMovement): number {
  validateMovementInput(movement);
  if (
    movement.sourceIsSiteOrZone !== undefined &&
    movement.destinationIsSiteOrZone !== undefined
  ) {
    const {
      sourceIsSiteOrZone,
      destinationIsSiteOrZone,
      movementType,
      quantity,
    } = movement;
    if (movementType === "adjustment")
      return sourceIsSiteOrZone || destinationIsSiteOrZone ? quantity : 0;
    return (
      (Number(destinationIsSiteOrZone) - Number(sourceIsSiteOrZone)) * quantity
    );
  }
  switch (movement.movementType) {
    case "site_receipt":
      return movement.quantity;
    case "return":
    case "transfer_in":
      return movement.quantity;
    case "shipment":
    case "installation":
    case "waste":
    case "transfer_out":
      return -movement.quantity;
    case "receipt":
      return 0;
    case "adjustment":
      return movement.quantity;
    case "reversal":
      return movementDeltaAtLocation(
        movement,
        movement.destinationLocationId ?? movement.sourceLocationId ?? 0,
      );
    default: {
      const exhaustive: never = movement.movementType;
      return exhaustive;
    }
  }
}

function assertNonNegative(
  value: number,
  allowNegative: boolean,
  label: string,
): void {
  if (value < 0 && !allowNegative) {
    domainError(
      "NEGATIVE_RESULT",
      `${label} cannot be negative without an explicit adjustment`,
    );
  }
}

export function calculateOnHandAtLocation(
  movements: readonly MovementInput[],
  locationId: number,
  material?: MaterialSnapshot,
): number {
  if (!positiveInteger(locationId)) {
    domainError("INVALID_MOVEMENT", "Location id must be a positive integer");
  }
  const allowNegative = movements.some(
    (movement) =>
      movement.movementType === "adjustment" &&
      movement.explicitAdjustment === true,
  );
  const result = movements.reduce((total, movement) => {
    if (material) {
      if (!sameMaterialIdentity(material, movement)) return total;
      assertMaterialMatch(material, movement, "Stock movement rows");
    }
    return total + movementDeltaAtLocation(movement, locationId);
  }, 0);
  assertNonNegative(result, allowNegative, "On-hand quantity");
  return result;
}

/** Site stock follows the architecture's receipt/return minus consumption formula. */
export function calculateSiteOnHand(
  movements: readonly RequirementMovement[],
  requirement?: RequirementSnapshot,
): number {
  const relevant = movements.filter((movement) => {
    if (!requirement) return true;
    if (movement.requirementId !== requirement.id) return false;
    assertMaterialMatch(
      requirement,
      movement,
      "Requirement and site movements",
    );
    return true;
  });
  const allowNegative = relevant.some(
    (movement) =>
      movement.movementType === "adjustment" &&
      movement.explicitAdjustment === true,
  );
  const result = relevant.reduce(
    (total, movement) => total + movementDeltaForSite(movement),
    0,
  );
  // A requirement can draw from site stock received outside its own ledger.
  if (
    requirement &&
    !allowNegative &&
    relevant.some((movement) => movement.sourceIsSiteOrZone !== undefined)
  ) {
    return Math.max(0, Number(result.toFixed(3)));
  }
  assertNonNegative(result, allowNegative, "Site on-hand quantity");
  return result;
}

function activeReservationQuantity(
  reservations: readonly ReservationState[],
  locationId: number,
  material?: MaterialSnapshot,
): number {
  return reservations.reduce((total, reservation) => {
    parseMaterialSnapshot(reservation);
    assertReservationStatus(reservation.status);
    assertPositiveQuantity(reservation.quantity, "Reservation quantity");
    if (
      reservation.locationId !== locationId ||
      reservation.status !== "active"
    )
      return total;
    if (material) {
      if (!sameMaterialIdentity(material, reservation)) return total;
      assertMaterialMatch(material, reservation, "Stock and reservation rows");
    }
    return total + reservation.quantity;
  }, 0);
}

/** On-hand quantity minus active reservations; released claims become available again. */
export function calculateSharedAvailable(
  input: SharedAvailabilityInput,
): number;
export function calculateSharedAvailable(
  movements: readonly MovementInput[],
  reservations: readonly ReservationState[],
  locationId: number,
  material?: MaterialSnapshot,
): number;
export function calculateSharedAvailable(
  inputOrMovements: SharedAvailabilityInput | readonly MovementInput[],
  inputReservations?: readonly ReservationState[],
  inputLocationId?: number,
  inputMaterial?: MaterialSnapshot,
): number {
  const input: SharedAvailabilityInput = isMovementList(inputOrMovements)
    ? {
        movements: inputOrMovements,
        reservations: inputReservations ?? [],
        locationId: inputLocationId ?? 0,
        material: inputMaterial,
      }
    : inputOrMovements;
  const onHand = calculateOnHandAtLocation(
    input.movements,
    input.locationId,
    input.material,
  );
  const reserved = activeReservationQuantity(
    input.reservations,
    input.locationId,
    input.material,
  );
  const allowNegative = input.movements.some(
    (movement) =>
      movement.movementType === "adjustment" &&
      movement.explicitAdjustment === true,
  );
  const result = onHand - reserved;
  assertNonNegative(result, allowNegative, "Shared available quantity");
  return result;
}

function isMovementList(
  value: SharedAvailabilityInput | readonly MovementInput[],
): value is readonly MovementInput[] {
  return Array.isArray(value);
}

export function validateTransferPair(
  outbound: MovementInput,
  inbound: MovementInput,
): void {
  validateMovementInput(outbound);
  validateMovementInput(inbound);
  if (
    outbound.movementType !== "transfer_out" ||
    inbound.movementType !== "transfer_in"
  ) {
    domainError(
      "INVALID_TRANSFER",
      "A transfer pair must contain transfer_out then transfer_in",
    );
  }
  if (
    outbound.destinationLocationId !== null ||
    inbound.sourceLocationId !== null
  ) {
    domainError(
      "INVALID_TRANSFER",
      "Transfer rows must contain one endpoint each",
    );
  }
  if (
    outbound.pairId !== inbound.pairId ||
    outbound.pairId === null ||
    outbound.pairId === undefined
  ) {
    domainError("INVALID_TRANSFER", "Transfer rows must share a pair id");
  }
  assertMaterialMatch(outbound, inbound, "Transfer rows");
  if (outbound.quantity !== inbound.quantity) {
    domainError("INVALID_TRANSFER", "Transfer rows must have equal quantities");
  }
  if (
    outbound.sourceLocationId === null ||
    inbound.destinationLocationId === null ||
    outbound.sourceLocationId === inbound.destinationLocationId
  ) {
    domainError(
      "INVALID_TRANSFER",
      "Transfer rows must have distinct transfer endpoints",
    );
  }
  if (outbound.requirementId !== inbound.requirementId) {
    domainError(
      "INVALID_TRANSFER",
      "Transfer rows must refer to the same requirement",
    );
  }
}

/** Create the two append-only rows needed to move stock between locations. */
export function createTransferPair(input: TransferInput): TransferPair {
  const snapshot = parseMaterialSnapshot(input);
  assertPositiveQuantity(input.quantity, "Transfer quantity");
  if (
    !positiveInteger(input.sourceLocationId) ||
    !positiveInteger(input.destinationLocationId) ||
    input.sourceLocationId === input.destinationLocationId
  ) {
    domainError(
      "INVALID_TRANSFER",
      "A transfer requires two distinct positive locations",
    );
  }
  if (
    input.pairId !== undefined &&
    input.pairId !== null &&
    !text(input.pairId)
  ) {
    domainError(
      "INVALID_TRANSFER",
      "A transfer pair id must be non-empty when supplied",
    );
  }
  const pairId =
    input.pairId ?? `${input.sourceLocationId}->${input.destinationLocationId}`;
  const outbound: MovementInput = {
    ...snapshot,
    movementType: "transfer_out",
    quantity: input.quantity,
    sourceLocationId: input.sourceLocationId,
    destinationLocationId: null,
    requirementId: input.requirementId ?? null,
    shipmentId: null,
    pairId,
    reversalOfId: null,
    explicitAdjustment: false,
  };
  const inbound: MovementInput = {
    ...snapshot,
    movementType: "transfer_in",
    quantity: input.quantity,
    sourceLocationId: null,
    destinationLocationId: input.destinationLocationId,
    requirementId: input.requirementId ?? null,
    shipmentId: null,
    pairId,
    reversalOfId: null,
    explicitAdjustment: false,
  };
  validateTransferPair(outbound, inbound);
  return [outbound, inbound];
}

function validDate(value: string | Date): Date {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    domainError("INVALID_DATE", "Requirement dates must be valid ISO dates");
  }
  return date;
}

export function isRequirementLate(
  requirement: RequirementSnapshot,
  now: string | Date,
  remainingToInstall = requirement.quantity,
): boolean {
  if (requirement.requiredAt === null || requirement.status === "cancelled")
    return false;
  if (remainingToInstall < 0 || !finiteNumber(remainingToInstall)) {
    domainError(
      "INVALID_QUANTITY",
      "Remaining quantity must be finite and non-negative",
    );
  }
  return (
    validDate(requirement.requiredAt).getTime() < validDate(now).getTime() &&
    remainingToInstall > 0
  );
}

export function calculateRequirementQuantities(
  input: RequirementSummaryInput,
): ReturnType<typeof calculateRequirementSummary> {
  return calculateRequirementSummary(input);
}

export function calculateRequirementSummary(input: RequirementSummaryInput): {
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
} {
  const requirement = input.requirement;
  parseMaterialSnapshot(requirement);
  assertPositiveQuantity(requirement.quantity, "Required quantity");
  if (!positiveInteger(requirement.id)) {
    domainError(
      "INVALID_QUANTITY",
      "Requirement id must be a positive integer",
    );
  }
  const lines = input.purchaseCommitmentLines ?? [];
  const shipmentLines = input.shipmentLines ?? [];
  const movements = input.movements ?? [];
  const ordered = calculateOrdered(lines, requirement);
  const shipped = Number(
    calculateShipped(shipmentLines, movements, requirement).toFixed(3),
  );
  const { received, shipmentReceived } = calculateReceiptQuantities(
    shipmentLines,
    movements,
    requirement,
  );
  const installed = calculateInstalled(movements, requirement);
  const remainingToInstall = calculateRemainingToInstall(
    requirement.quantity,
    installed,
  );
  const siteOnHand = calculateSiteOnHand(movements, requirement);
  const sharedAvailable =
    requirement.targetLocationId === null || input.reservations === undefined
      ? null
      : calculateSharedAvailable(
          movements,
          input.reservations,
          requirement.targetLocationId,
          requirement,
        );
  // Direct site receipts contribute to received totals independently of transit.
  const inTransit =
    shipped === 0
      ? 0
      : Number(
          calculateInTransit(
            shipped,
            Number(shipmentReceived.toFixed(3)),
          ).toFixed(3),
        );
  return {
    required: requirement.quantity,
    ordered,
    missingToBuy: calculateMissingToBuy(requirement.quantity, ordered),
    shipped,
    received: Number(received.toFixed(3)),
    inTransit,
    installed,
    remainingToInstall,
    siteOnHand,
    sharedAvailable,
    late:
      input.now === undefined
        ? false
        : isRequirementLate(requirement, input.now, remainingToInstall),
  };
}

// Named aliases keep the metric vocabulary stable at call sites.
export const orderedQuantity = calculateOrdered;
export const missingToBuy = calculateMissingToBuy;
export const shippedQuantity = calculateShipped;
export const receivedQuantity = calculateReceived;
export const inTransitQuantity = calculateInTransit;
export const installedQuantity = calculateInstalled;
export const remainingToInstall = calculateRemainingToInstall;
export const siteOnHand = calculateSiteOnHand;
export const sharedAvailable = calculateSharedAvailable;
