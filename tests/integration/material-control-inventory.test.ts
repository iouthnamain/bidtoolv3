import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { expect, test as base } from "vitest";

import * as schema from "~/server/db/schema";
import {
  getDashboardSummary,
  getPlanDetail,
  listPlanDetails,
  listShortages,
  listStockBalances,
} from "~/server/services/material-control/inventory-queries";
import {
  recordMovement,
  recordTransfer,
  reverseMovement,
  type RecordMovementInput,
} from "~/server/services/material-control/movement-service";
import {
  createLocation,
  createPlan,
  createProject,
} from "~/server/services/material-control/project-service";
import { createRequirement } from "~/server/services/material-control/requirement-service";
import {
  createShipment,
  dispatchShipment,
  receiveShipment,
} from "~/server/services/material-control/shipment-service";
import { requireTestDatabase } from "../fixtures/remediation/test-target";

async function seedInventory(
  database: ReturnType<typeof drizzle<typeof schema>>,
  projectId: number,
) {
  const location = (
    type: "warehouse" | "site" | "zone" | "installed",
    parentId?: number,
  ) =>
    createLocation(
      { projectId, code: type, name: type, type, parentId },
      database,
    );
  const [warehouse, site, installed] = await Promise.all([
    location("warehouse"),
    location("site"),
    location("installed"),
  ]);
  const zone = await location("zone", site.id);
  const plan = await createPlan(
    { projectId, name: "Inventory plan" },
    database,
  );
  const requirement = await createRequirement(
    {
      planId: plan.id,
      materialName: "Cáp điện",
      specText: "CV 3x2.5",
      unit: "m",
      quantity: 30,
      targetLocationId: site.id,
    },
    database,
  );
  const record = (input: Omit<RecordMovementInput, "requirementId">) =>
    recordMovement({ ...input, requirementId: requirement.id }, database);
  const draftShipment = (sourceLocationId: number, quantity: number) =>
    createShipment(
      {
        projectId,
        sourceLocationId,
        destinationLocationId: site.id,
        lines: [{ requirementId: requirement.id, quantity }],
      },
      database,
    );

  return {
    database,
    projectId,
    warehouse,
    site,
    installed,
    zone,
    plan,
    requirement,
    record,
    draftShipment,
  };
}

type Inventory = Awaited<ReturnType<typeof seedInventory>>;

const test = base.extend<{ inventory: Inventory }>({
  inventory: async ({ task }, provide) => {
    const client = postgres(requireTestDatabase());
    const database = drizzle(client, { schema });
    try {
      const { id: projectId } = await createProject(
        { name: task.name },
        database,
      );
      try {
        await provide(await seedInventory(database, projectId));
      } finally {
        await database.transaction(async (tx) => {
          await tx
            .delete(schema.materialControlStockMovements)
            .where(
              eq(schema.materialControlStockMovements.projectId, projectId),
            );
          await tx
            .delete(schema.materialControlShipments)
            .where(eq(schema.materialControlShipments.projectId, projectId));
          const { materialControlLocations: locations } = schema;
          await tx.delete(locations).where(eq(locations.projectId, projectId));
          await tx
            .delete(schema.materialControlProjects)
            .where(eq(schema.materialControlProjects.id, projectId));
        });
      }
    } finally {
      await client.end();
    }
  },
});

async function expectInventory(
  { database, projectId, plan, requirement }: Inventory,
  expected: {
    shipped: number;
    received: number;
    inTransit: number;
    siteOnHand: number;
    installed?: number;
  },
) {
  const { shipped, received, inTransit, installed = 0 } = expected;
  const logistics = { shipped, received, inTransit, installed };
  const requirementWithSummary = { id: requirement.id, summary: expected };
  const requirements = [requirementWithSummary];

  await Promise.all([
    expect
      .soft(getPlanDetail(plan.id, {}, database))
      .resolves.toMatchObject({ requirements, totals: expected }),
    expect
      .soft(listPlanDetails({ projectId }, database))
      .resolves.toMatchObject([{ requirements, totals: expected }]),
    expect
      .soft(getDashboardSummary({ projectId }, database))
      .resolves.toMatchObject({ logistics }),
    expect
      .soft(listShortages({ projectId }, database))
      .resolves.toMatchObject([{ requirement: requirementWithSummary }]),
  ]);
}

test("uses both physical endpoints for warehouse receipts, transfers and reversals", async ({
  inventory,
}) => {
  const { database, projectId, warehouse, zone, requirement, record } =
    inventory;
  const secondWarehouse = await createLocation(
    { projectId, code: "KHO-2", name: "Kho 2", type: "warehouse" },
    database,
  );
  await record({
    movementType: "receipt",
    destinationLocationId: warehouse.id,
    quantity: 12,
  });
  const sent = await record({
    movementType: "shipment",
    sourceLocationId: warehouse.id,
    quantity: 4,
  });
  await reverseMovement(sent.id, database);
  await record({
    movementType: "site_receipt",
    destinationLocationId: secondWarehouse.id,
    quantity: 4,
  });
  await expectInventory(inventory, {
    shipped: 4,
    received: 4,
    inTransit: 0,
    siteOnHand: 0,
  });

  await recordTransfer(
    {
      projectId,
      requirementId: requirement.id,
      sourceLocationId: warehouse.id,
      destinationLocationId: zone.id,
      quantity: 6,
    },
    database,
  );
  await expectInventory(inventory, {
    shipped: 4,
    received: 4,
    inTransit: 0,
    siteOnHand: 6,
  });
});

test("ignores a foreign shipment when reading old ledger entries and rejects new links", async ({
  inventory,
}) => {
  const { database, warehouse, site, record } = inventory;
  const other = await createProject(
    { name: "Other inventory fixture" },
    database,
  );
  try {
    const [foreignShipment] = await database
      .insert(schema.materialControlShipments)
      .values({
        projectId: other.id,
        sourceLocationId: warehouse.id,
        destinationLocationId: site.id,
      })
      .returning({ id: schema.materialControlShipments.id });
    if (!foreignShipment) throw new Error("Foreign shipment fixture missing.");
    await record({
      movementType: "receipt",
      destinationLocationId: warehouse.id,
      quantity: 4,
    });
    const shipment = {
      movementType: "shipment",
      sourceLocationId: warehouse.id,
      quantity: 4,
    } as const;
    await expect(
      record({ ...shipment, shipmentId: foreignShipment.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const legacy = await record(shipment);
    await database
      .update(schema.materialControlStockMovements)
      .set({ shipmentId: foreignShipment.id })
      .where(eq(schema.materialControlStockMovements.id, legacy.id));
    await expectInventory(inventory, {
      shipped: 4,
      received: 0,
      inTransit: 4,
      siteOnHand: 0,
    });
  } finally {
    await database
      .delete(schema.materialControlProjects)
      .where(eq(schema.materialControlProjects.id, other.id));
  }
});

test("ignores draft, ready, and cancelled shipments while counting a direct site receipt", async ({
  inventory,
}) => {
  const { database, warehouse, site, draftShipment, record } = inventory;
  await record({
    movementType: "receipt",
    destinationLocationId: warehouse.id,
    quantity: 1,
  });
  await draftShipment(warehouse.id, 3);
  for (const status of ["ready", "cancelled"] as const) {
    const shipment = await draftShipment(warehouse.id, 3);
    await database
      .update(schema.materialControlShipments)
      .set({ status })
      .where(eq(schema.materialControlShipments.id, shipment.id));
    if (status === "cancelled") {
      await record({
        movementType: "shipment",
        sourceLocationId: warehouse.id,
        shipmentId: shipment.id,
        quantity: 1,
      });
    }
  }
  await record({
    movementType: "site_receipt",
    destinationLocationId: site.id,
    quantity: 2,
  });

  await expectInventory(inventory, {
    shipped: 0,
    received: 2,
    inTransit: 0,
    siteOnHand: 2,
  });
});

test("reads the warehouse shipment from draft through partial and full receipt", async ({
  inventory,
}) => {
  const { database, projectId, warehouse, site, draftShipment, record } =
    inventory;
  const balances = (locationId: number) =>
    listStockBalances({ projectId, locationId }, database);
  await record({
    movementType: "receipt",
    destinationLocationId: warehouse.id,
    quantity: 20,
  });
  const shipment = await draftShipment(warehouse.id, 10);
  const [line] = shipment.lines;
  if (!line) throw new Error("Shipment line was not created.");
  const receive = (quantity: number) =>
    receiveShipment(shipment.id, [{ lineId: line.id, quantity }], database);

  expect(shipment.status).toBe("draft");
  await expectInventory(inventory, {
    shipped: 0,
    received: 0,
    inTransit: 0,
    siteOnHand: 0,
  });
  await expect(balances(warehouse.id)).resolves.toMatchObject([{ onHand: 20 }]);

  await expect(dispatchShipment(shipment.id, database)).resolves.toMatchObject({
    status: "in_transit",
  });
  await expectInventory(inventory, {
    shipped: 10,
    received: 0,
    inTransit: 10,
    siteOnHand: 0,
  });
  await expect(balances(warehouse.id)).resolves.toMatchObject([{ onHand: 10 }]);

  await expect(receive(4)).resolves.toMatchObject({
    status: "partially_received",
  });
  await expectInventory(inventory, {
    shipped: 10,
    received: 4,
    inTransit: 6,
    siteOnHand: 4,
  });
  await expect(balances(site.id)).resolves.toMatchObject([{ onHand: 4 }]);

  await expect(receive(6)).resolves.toMatchObject({ status: "received" });
  await expectInventory(inventory, {
    shipped: 10,
    received: 10,
    inTransit: 0,
    siteOnHand: 10,
  });
});

test("keeps zone dispatch, installation, and returns in site stock", async ({
  inventory,
}) => {
  const { database, zone, installed, record, draftShipment } = inventory;
  await record({
    movementType: "site_receipt",
    destinationLocationId: zone.id,
    quantity: 12,
  });
  await record({
    movementType: "installation",
    sourceLocationId: zone.id,
    destinationLocationId: installed.id,
    quantity: 3,
  });
  await record({
    movementType: "return",
    sourceLocationId: installed.id,
    destinationLocationId: zone.id,
    quantity: 1,
  });
  const shipment = await draftShipment(zone.id, 2);
  await dispatchShipment(shipment.id, database);
  await record({
    movementType: "shipment",
    sourceLocationId: zone.id,
    quantity: 1,
  });

  await expectInventory(inventory, {
    shipped: 3,
    received: 12,
    inTransit: 3,
    siteOnHand: 7,
    installed: 3,
  });
});
