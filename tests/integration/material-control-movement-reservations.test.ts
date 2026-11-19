import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { expect, test as base } from "vitest";

import { materialControlRouter } from "~/server/api/routers/material-control";
import { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";
import {
  materialControlLocations,
  materialControlProjects,
  materialControlStockMovements,
} from "~/server/db/schema";
import { listStockBalances } from "~/server/services/material-control/inventory-queries";
import {
  recordMovement,
  recordTransfer,
  reverseMovement,
} from "~/server/services/material-control/movement-service";
import {
  createReservation,
  listReservations,
  releaseReservation,
} from "~/server/services/material-control/procurement-service";
import {
  createLocation,
  createPlan,
  createProject,
} from "~/server/services/material-control/project-service";
import { createRequirement } from "~/server/services/material-control/requirement-service";
import {
  createShipment,
  dispatchShipment,
  getShipment,
} from "~/server/services/material-control/shipment-service";

async function seedStock() {
  const [owner, other] = await Promise.all([
    createProject({ name: "Reservation owner" }),
    createProject({ name: "Other project" }),
  ]);
  const warehouse = await createLocation({
    code: randomUUID(),
    name: "Shared warehouse",
    type: "warehouse",
  });
  const site = await createLocation({
    projectId: other.id,
    code: "SITE",
    name: "Other project site",
    type: "site",
  });
  const material = {
    materialName: "Cáp điện",
    specText: "CV 3x2.5",
    unit: "m",
  };

  return {
    owner,
    other,
    warehouse,
    site,
    material,
    receive: (quantity: number) =>
      recordMovement({
        ...material,
        movementType: "receipt",
        quantity,
        destinationLocationId: warehouse.id,
      }),
    reserve: (quantity: number, requirementId?: number) =>
      createReservation({
        ...material,
        projectId: owner.id,
        requirementId,
        locationId: warehouse.id,
        quantity,
      }),
    shipment: (quantity: number) =>
      createShipment({
        projectId: other.id,
        sourceLocationId: warehouse.id,
        destinationLocationId: site.id,
        lines: [{ ...material, quantity }],
      }),
  };
}

const test = base.extend<{ stock: Awaited<ReturnType<typeof seedStock>> }>({
  stock: async ({}, provide) => {
    const stock = await seedStock();
    try {
      await provide(stock);
    } finally {
      const locationIds = [stock.warehouse.id, stock.site.id];
      await db.transaction(async (tx) => {
        await tx
          .delete(materialControlStockMovements)
          .where(
            or(
              inArray(
                materialControlStockMovements.sourceLocationId,
                locationIds,
              ),
              inArray(
                materialControlStockMovements.destinationLocationId,
                locationIds,
              ),
            ),
          );
        await tx
          .delete(materialControlProjects)
          .where(
            inArray(materialControlProjects.id, [
              stock.owner.id,
              stock.other.id,
            ]),
          );
        await tx
          .delete(materialControlLocations)
          .where(inArray(materialControlLocations.id, locationIds));
      });
    }
  },
});

test("protects another project's stock claim from dispatch, waste, transfer and reversal", async ({
  stock: { other, warehouse, site, material, receive, reserve, shipment },
}) => {
  const opening = await receive(10);
  const claim = await reserve(8);
  const draft = await shipment(3);
  const outbound = {
    ...material,
    projectId: other.id,
    sourceLocationId: warehouse.id,
    quantity: 3,
  };

  await expect
    .soft(dispatchShipment(draft.id))
    .rejects.toMatchObject({ code: "CONFLICT" });
  await expect
    .soft(getShipment(draft.id))
    .resolves.toMatchObject({ status: "draft" });
  await expect
    .soft(recordMovement({ ...outbound, movementType: "waste" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  await expect
    .soft(recordTransfer({ ...outbound, destinationLocationId: site.id }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  await expect
    .soft(reverseMovement(opening.id))
    .rejects.toMatchObject({ code: "CONFLICT" });

  await releaseReservation(claim.id);
  await expect(dispatchShipment(draft.id)).resolves.toMatchObject({
    status: "in_transit",
  });
  await expect(
    listStockBalances({ locationId: warehouse.id }),
  ).resolves.toMatchObject([{ onHand: 7, reserved: 0, available: 7 }]);
});

test("serializes a reservation and shipment competing for the same stock", async ({
  stock: { warehouse, receive, reserve, shipment },
}) => {
  await receive(5);
  const draft = await shipment(5);
  const outcome = await Promise.allSettled([
    reserve(5),
    dispatchShipment(draft.id),
  ]);

  expect(outcome.filter((entry) => entry.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(outcome.find((entry) => entry.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  await expect(
    listStockBalances({ locationId: warehouse.id }),
  ).resolves.toMatchObject([{ available: 0, oversubscribed: false }]);
});

test("only the assigned project and requirement can fulfill a reservation and reversal restores it", async ({
  stock: { owner, other, warehouse, material, receive, reserve },
}) => {
  await receive(5);
  const plan = await createPlan({
    projectId: owner.id,
    name: "Reservation plan",
  });
  const requirement = await createRequirement({
    ...material,
    planId: plan.id,
    quantity: 5,
  });
  const claim = await reserve(5, requirement.id);
  const outbound = {
    ...material,
    movementType: "shipment",
    sourceLocationId: warehouse.id,
    reservationId: claim.id,
    quantity: 5,
  } as const;

  await expect
    .soft(recordMovement({ ...outbound, projectId: other.id }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect
    .soft(recordMovement({ ...outbound, projectId: owner.id }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    recordMovement({ ...outbound, requirementId: requirement.id, quantity: 4 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const dispatched = await recordMovement({
    ...outbound,
    requirementId: requirement.id,
  });
  expect(dispatched.reservationId).toBe(claim.id);
  await expect(
    recordMovement({ ...outbound, requirementId: requirement.id }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    listReservations({ projectId: owner.id }),
  ).resolves.toMatchObject([
    { id: claim.id, status: "fulfilled", quantity: 5 },
  ]);
  await expect(
    listStockBalances({ locationId: warehouse.id }),
  ).resolves.toMatchObject([{ onHand: 0, reserved: 0, available: 0 }]);

  await expect(reverseMovement(dispatched.id)).resolves.toMatchObject({
    reversalOfId: dispatched.id,
  });
  await expect(
    listReservations({ projectId: owner.id }),
  ).resolves.toMatchObject([{ id: claim.id, status: "active", quantity: 5 }]);
  await expect(
    listStockBalances({ locationId: warehouse.id }),
  ).resolves.toMatchObject([{ onHand: 5, reserved: 5, available: 0 }]);
  await expect(reverseMovement(dispatched.id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});

test("reversing a legacy linked movement preserves a manually fulfilled reservation", async ({
  stock: { owner, warehouse, material, receive, reserve },
}) => {
  await receive(5);
  const claim = await reserve(5);
  await releaseReservation(claim.id, "fulfilled");
  const dispatched = await recordMovement({
    ...material,
    projectId: owner.id,
    movementType: "shipment",
    sourceLocationId: warehouse.id,
    quantity: 5,
  });
  await db
    .update(materialControlStockMovements)
    .set({ reservationId: claim.id })
    .where(eq(materialControlStockMovements.id, dispatched.id));

  await reverseMovement(dispatched.id);
  await expect(
    listReservations({ projectId: owner.id }),
  ).resolves.toMatchObject([
    { id: claim.id, status: "fulfilled", quantity: 5 },
  ]);
});

test("generic reversal requests use the recorded movement to restore its reservation", async ({
  stock: { owner, warehouse, material, receive, reserve },
}) => {
  const caller = materialControlRouter.createCaller(
    await createTRPCContext({ headers: new Headers() }),
  );
  await receive(5);
  const claim = await reserve(5);
  const dispatched = await recordMovement({
    ...material,
    projectId: owner.id,
    movementType: "shipment",
    sourceLocationId: warehouse.id,
    quantity: 5,
    reservationId: claim.id,
  });
  const reversal = {
    ...material,
    projectId: owner.id,
    movementType: "reversal",
    reversalOfId: dispatched.id,
    destinationLocationId: warehouse.id,
    quantity: 5,
  } as const;

  await expect
    .soft(caller.recordMovement({ ...reversal, quantity: 4 }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect
    .soft(caller.recordMovement({ ...reversal, movementType: "receipt" }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(caller.recordMovement(reversal)).resolves.toMatchObject({
    reversalOfId: dispatched.id,
    reservationId: claim.id,
  });
  await expect(
    listReservations({ projectId: owner.id }),
  ).resolves.toMatchObject([{ id: claim.id, status: "active", quantity: 5 }]);
  await expect(
    listStockBalances({ locationId: warehouse.id }),
  ).resolves.toMatchObject([{ onHand: 5, reserved: 5, available: 0 }]);
});

test("reservation and dispatch share the exact three-decimal stock balance", async ({
  stock: { warehouse, receive, reserve, shipment },
}) => {
  await receive(0.3);
  await reserve(0.1);
  const draft = await shipment(0.2);

  await expect(dispatchShipment(draft.id)).resolves.toMatchObject({
    status: "in_transit",
  });
  await expect(reserve(0.001)).rejects.toMatchObject({ code: "CONFLICT" });
});

test("explicit adjustments stay possible without allowing negative ordinary stock writes", async ({
  stock: { warehouse, other, site, material, receive },
}) => {
  const waste = {
    ...material,
    projectId: other.id,
    movementType: "waste",
    sourceLocationId: warehouse.id,
    quantity: 1,
  } as const;
  const adjustment = {
    ...material,
    projectId: other.id,
    movementType: "adjustment",
    explicitAdjustment: true,
  } as const;

  await recordMovement({
    ...adjustment,
    destinationLocationId: site.id,
    quantity: 2,
  });
  await expect
    .soft(recordMovement(waste))
    .rejects.toMatchObject({ code: "CONFLICT" });

  const correction = await recordMovement({
    ...adjustment,
    sourceLocationId: warehouse.id,
    quantity: -2,
  });
  await expect
    .soft(recordMovement(waste))
    .rejects.toMatchObject({ code: "CONFLICT" });
  await receive(1);
  await reverseMovement(correction.id);
  await expect(
    listStockBalances({ locationId: warehouse.id }),
  ).resolves.toMatchObject([{ onHand: 1, available: 1 }]);
});
