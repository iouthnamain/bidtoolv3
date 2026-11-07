import { describe, expect, it } from "vitest";

import { aggregateStockBalances } from "./inventory-queries";
import type {
  MaterialSnapshot,
  MovementInput,
  ReservationState,
} from "./types";

const cable: MaterialSnapshot = {
  materialId: 10,
  materialName: "Cáp điện",
  specText: "CV 3x2.5",
  unit: "m",
};

function movement(
  overrides: Partial<MovementInput> &
    Pick<MovementInput, "movementType" | "quantity">,
): MovementInput {
  return {
    ...cable,
    sourceLocationId: null,
    destinationLocationId: null,
    requirementId: null,
    shipmentId: null,
    pairId: null,
    reversalOfId: null,
    explicitAdjustment: false,
    ...overrides,
  };
}

describe("material-control inventory query aggregation", () => {
  it("groups receipts, transfers, and reservations by location and snapshot", () => {
    const movements: MovementInput[] = [
      movement({
        movementType: "receipt",
        quantity: 100,
        destinationLocationId: 1,
      }),
      movement({
        movementType: "transfer_out",
        quantity: 30,
        sourceLocationId: 1,
      }),
      movement({
        movementType: "transfer_in",
        quantity: 30,
        destinationLocationId: 2,
      }),
    ];
    const reservations: ReservationState[] = [
      { ...cable, locationId: 1, quantity: 20, status: "active" },
      { ...cable, locationId: 1, quantity: 5, status: "released" },
      { ...cable, locationId: 2, quantity: 10, status: "active" },
    ];

    expect(aggregateStockBalances(movements, reservations)).toEqual([
      {
        locationId: 1,
        material: cable,
        onHand: 70,
        reserved: 20,
        available: 50,
        oversubscribed: false,
      },
      {
        locationId: 2,
        material: cable,
        onHand: 30,
        reserved: 10,
        available: 20,
        oversubscribed: false,
      },
    ]);
  });

  it("keeps provisional materials separate from catalog-linked rows", () => {
    const provisional: MaterialSnapshot = {
      materialId: null,
      materialName: cable.materialName,
      specText: cable.specText,
      unit: cable.unit,
    };
    const rows = aggregateStockBalances(
      [
        movement({
          movementType: "receipt",
          quantity: 4,
          destinationLocationId: 1,
        }),
        {
          ...movement({
            movementType: "receipt",
            quantity: 6,
            destinationLocationId: 1,
          }),
          ...provisional,
        },
      ],
      [],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.onHand).sort()).toEqual([4, 6]);
  });
});
