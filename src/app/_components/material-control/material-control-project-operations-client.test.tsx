import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { MaterialControlProjectOperationsClient } from "./material-control-project-operations-client";

vi.mock("~/trpc/react", () => ({
  api: {
    materialControl: {
      listPurchaseCommitments: { useQuery: () => ({}) },
      listMovements: { useQuery: () => ({}) },
      listShipments: {
        useQuery: () => ({
          data: [
            {
              id: 1,
              status: "partially_received",
              lines: [
                {
                  id: 1,
                  material: { materialName: "Ống", unit: "m" },
                  quantity: 2,
                  receivedQuantity: 1,
                },
                {
                  id: 2,
                  material: { materialName: "Ốc vít", unit: "hộp" },
                  quantity: 3,
                  receivedQuantity: 0,
                },
              ],
            },
          ],
        }),
      },
    },
  },
}));

test("shipment receipt progress keeps different units separate", () => {
  const markup = renderToStaticMarkup(
    <MaterialControlProjectOperationsClient projectId={1} mode="shipments" />,
  );

  expect(markup).toContain("Ống: Đã nhận 1 / 2 m");
  expect(markup).toContain("Ốc vít: Đã nhận 0 / 3 hộp");
  expect(markup).not.toContain("Đã nhận 1 / 5");
});
