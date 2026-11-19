import { and, asc, eq, inArray } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import { db } from "~/server/db";
import {
  materialControlLocations,
  materialControlProjects,
  materialControlStockMovements,
} from "~/server/db/schema";
import { recordMovement } from "~/server/services/material-control/movement-service";
import {
  createLocation,
  createProject,
} from "~/server/services/material-control/project-service";
import {
  createShipment,
  dispatchShipment,
  getShipment,
  receiveShipment,
} from "~/server/services/material-control/shipment-service";

let projectId: number | undefined;
const locationIds: number[] = [];

afterEach(async () => {
  if (projectId === undefined) return;
  await db
    .delete(materialControlStockMovements)
    .where(eq(materialControlStockMovements.projectId, projectId));
  await db
    .delete(materialControlProjects)
    .where(eq(materialControlProjects.id, projectId));
  await db
    .delete(materialControlLocations)
    .where(inArray(materialControlLocations.id, locationIds));
  projectId = undefined;
  locationIds.length = 0;
});

async function seedShipment(quantity: number) {
  const project = await createProject({ name: "Kiểm thử nhận hàng" });
  projectId = project.id;
  const source = await createLocation({
    projectId,
    code: "KHO",
    name: "Kho",
    type: "warehouse",
  });
  locationIds.push(source.id);
  const destination = await createLocation({
    projectId,
    code: "CT",
    name: "Công trường",
    type: "site",
  });
  locationIds.push(destination.id);
  const material = { materialName: "Dây cáp", specText: "CV 3x2.5", unit: "m" };
  await recordMovement({
    ...material,
    projectId,
    movementType: "receipt",
    quantity,
    destinationLocationId: source.id,
  });
  const shipment = await createShipment({
    projectId,
    sourceLocationId: source.id,
    destinationLocationId: destination.id,
    lines: [{ ...material, quantity }],
  });
  const [line] = shipment.lines;
  if (!line) throw new Error("Fixture shipment has no line.");
  await dispatchShipment(shipment.id);
  return { id: shipment.id, lineId: line.id };
}

async function receivedAmounts(shipmentId: number) {
  const rows = await db
    .select({ quantity: materialControlStockMovements.quantity })
    .from(materialControlStockMovements)
    .where(
      and(
        eq(materialControlStockMovements.shipmentId, shipmentId),
        eq(materialControlStockMovements.movementType, "site_receipt"),
      ),
    )
    .orderBy(asc(materialControlStockMovements.id));
  return rows.map(({ quantity }) => quantity);
}

test("accepts decimal receipts up to exactly the shipped quantity", async () => {
  const { id, lineId } = await seedShipment(0.3);

  const partial = await receiveShipment(id, [{ lineId, quantity: 0.1 }]);
  expect(partial.status).toBe("partially_received");
  await expect(
    receiveShipment(id, [{ lineId, quantity: 0.201 }]),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });

  const completed = await receiveShipment(id, [{ lineId, quantity: 0.2 }]);
  expect(completed.status).toBe("received");
  expect(completed.lines[0]?.receivedQuantity).toBe(0.3);
  expect(await receivedAmounts(id)).toEqual([0.1, 0.2]);
});

test.each([
  ["empty selections", (_lineId: number) => []],
  [
    "duplicate line IDs",
    (lineId: number) => [
      { lineId, quantity: 1 },
      { lineId, quantity: 1 },
    ],
  ],
  [
    "lines outside the shipment",
    (lineId: number) => [
      { lineId, quantity: 1 },
      { lineId: lineId + 1, quantity: 1 },
    ],
  ],
  [
    "values below storage precision",
    (lineId: number) => [{ lineId, quantity: 1e-7 }],
  ],
] as const)("rejects %s without recording stock", async (_reason, lines) => {
  const { id, lineId } = await seedShipment(5);

  await expect(receiveShipment(id, lines(lineId))).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect((await getShipment(id)).status).toBe("in_transit");
  expect(await receivedAmounts(id)).toEqual([]);
});
