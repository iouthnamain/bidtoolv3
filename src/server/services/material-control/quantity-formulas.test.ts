import { describe, expect, it } from "vitest";

import {
  calculateInTransit,
  calculateRequirementSummary,
  calculateSharedAvailable,
  createTransferPair,
  isRequirementLate,
  parseMaterialSnapshot,
  validateMovementInput,
  validateTransferPair,
  withCatalogLink,
} from "./quantity-formulas";
import type {
  MaterialSnapshot,
  MovementInput,
  RequirementSnapshot,
  ReservationState,
} from "./types";

const snapshot: MaterialSnapshot = {
  materialId: null,
  materialName: "Cáp điện",
  specText: "CV 3x2.5",
  unit: "m",
};

const requirement: RequirementSnapshot = {
  ...snapshot,
  id: 7,
  quantity: 100,
  requiredAt: "2026-11-05T00:00:00.000Z",
  targetLocationId: 20,
};

function movement(
  overrides: Partial<MovementInput> &
    Pick<MovementInput, "movementType" | "quantity">,
): MovementInput {
  return {
    ...snapshot,
    sourceLocationId: null,
    destinationLocationId: null,
    requirementId: requirement.id,
    shipmentId: null,
    pairId: null,
    reversalOfId: null,
    explicitAdjustment: false,
    ...overrides,
  };
}

describe("material-control quantity formulas", () => {
  it("derives ordered, partial receipt, transit, installation, and shortage quantities", () => {
    const summary = calculateRequirementSummary({
      requirement,
      purchaseCommitmentLines: [
        {
          ...snapshot,
          id: 1,
          requirementId: requirement.id,
          quantity: 60,
          status: "committed",
        },
        {
          ...snapshot,
          id: 2,
          requirementId: requirement.id,
          quantity: 20,
          status: "received",
        },
      ],
      shipmentLines: [
        {
          ...snapshot,
          id: 3,
          requirementId: requirement.id,
          quantity: 50,
          receivedQuantity: 20,
        },
      ],
      movements: [
        movement({
          movementType: "site_receipt",
          quantity: 20,
          destinationLocationId: 20,
        }),
        movement({
          movementType: "installation",
          quantity: 8,
          sourceLocationId: 20,
          destinationLocationId: 21,
        }),
      ],
      now: "2026-11-06T00:00:00.000Z",
    });

    expect(summary).toMatchObject({
      required: 100,
      ordered: 80,
      missingToBuy: 20,
      shipped: 50,
      received: 20,
      inTransit: 30,
      installed: 8,
      remainingToInstall: 92,
      siteOnHand: 12,
      late: true,
    });
  });

  it("accounts for returns and waste in site on-hand", () => {
    const summary = calculateRequirementSummary({
      requirement,
      movements: [
        movement({
          movementType: "site_receipt",
          quantity: 20,
          destinationLocationId: 20,
        }),
        movement({
          movementType: "installation",
          quantity: 5,
          sourceLocationId: 20,
          destinationLocationId: 21,
        }),
        movement({
          movementType: "return",
          quantity: 3,
          sourceLocationId: 21,
          destinationLocationId: 20,
        }),
        movement({ movementType: "waste", quantity: 2, sourceLocationId: 20 }),
      ],
    });

    expect(summary.siteOnHand).toBe(16);
  });

  it("creates and validates paired transfer rows", () => {
    const pair = createTransferPair({
      ...snapshot,
      quantity: 12,
      sourceLocationId: 10,
      destinationLocationId: 11,
      requirementId: requirement.id,
      pairId: "transfer-1",
    });

    expect(pair[0]).toMatchObject({
      movementType: "transfer_out",
      sourceLocationId: 10,
      destinationLocationId: null,
      pairId: "transfer-1",
    });
    expect(pair[1]).toMatchObject({
      movementType: "transfer_in",
      sourceLocationId: null,
      destinationLocationId: 11,
      pairId: "transfer-1",
    });
    expect(() =>
      validateTransferPair(pair[0], { ...pair[1], quantity: 11 }),
    ).toThrowError(/equal quantities/);
  });

  it("excludes released reservations from shared availability", () => {
    const stock = movement({
      movementType: "receipt",
      quantity: 50,
      destinationLocationId: 10,
      requirementId: null,
    });
    const reservations: ReservationState[] = [
      { ...snapshot, id: 1, locationId: 10, quantity: 15, status: "active" },
      { ...snapshot, id: 2, locationId: 10, quantity: 20, status: "released" },
    ];

    expect(
      calculateSharedAvailable({
        movements: [stock],
        reservations,
        locationId: 10,
        material: snapshot,
      }),
    ).toBe(35);
  });

  it("rejects unit mismatches, invalid directions, and negative stock", () => {
    expect(() =>
      calculateRequirementSummary({
        requirement,
        purchaseCommitmentLines: [
          {
            ...snapshot,
            requirementId: requirement.id,
            quantity: 1,
            status: "committed",
            unit: "kg",
          },
        ],
      }),
    ).toThrowError(/incompatible units/);

    expect(() =>
      validateMovementInput(
        movement({
          movementType: "receipt",
          quantity: 1,
          destinationLocationId: null,
        }),
      ),
    ).toThrowError(/destination location/);

    expect(() =>
      calculateSharedAvailable({
        movements: [
          movement({
            movementType: "shipment",
            quantity: 2,
            sourceLocationId: 10,
          }),
        ],
        reservations: [],
        locationId: 10,
        material: snapshot,
      }),
    ).toThrowError(/cannot be negative/);
  });

  it("allows only explicit signed adjustments to produce a negative balance", () => {
    const adjustment = movement({
      movementType: "adjustment",
      quantity: -4,
      sourceLocationId: 10,
      explicitAdjustment: true,
      requirementId: null,
    });
    expect(
      calculateSharedAvailable({
        movements: [adjustment],
        reservations: [],
        locationId: 10,
        material: snapshot,
      }),
    ).toBe(-4);
    expect(() =>
      validateMovementInput(
        movement({
          movementType: "adjustment",
          quantity: -4,
          sourceLocationId: 10,
        }),
      ),
    ).toThrowError(/greater than zero/);
  });

  it("preserves the snapshot when a provisional catalog link changes", () => {
    const linked = withCatalogLink(snapshot, 42);
    expect(linked).toEqual({ ...snapshot, materialId: 42 });
    expect(snapshot).toEqual({
      materialId: null,
      materialName: "Cáp điện",
      specText: "CV 3x2.5",
      unit: "m",
    });
    expect(parseMaterialSnapshot({ ...linked, materialId: null })).toEqual(
      snapshot,
    );
  });

  it("marks only unfinished past requirements as late", () => {
    expect(isRequirementLate(requirement, "2026-11-06T00:00:00.000Z", 1)).toBe(
      true,
    );
    expect(isRequirementLate(requirement, "2026-11-06T00:00:00.000Z", 0)).toBe(
      false,
    );
    expect(calculateInTransit(10, 4)).toBe(6);
    expect(() => calculateInTransit(4, 10)).toThrowError(/cannot exceed/);
  });
});
