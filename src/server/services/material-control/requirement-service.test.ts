import { describe, expect, it } from "vitest";

import {
  captureRequirementSnapshot,
  validateRequirementDate,
  validateRequirementQuantity,
} from "~/server/services/material-control/requirement-service";

describe("material-control requirement commands", () => {
  it("keeps a provisional snapshot when the catalog link is added later", () => {
    const snapshot = captureRequirementSnapshot({
      materialId: null,
      materialName: "Ống thép provisional",
      specText: "DN50, SCH40",
      unit: "m",
    });

    expect(snapshot).toEqual({
      materialId: null,
      materialName: "Ống thép provisional",
      specText: "DN50, SCH40",
      unit: "m",
    });
  });

  it("uses the catalog only to fill omitted snapshot fields", () => {
    const snapshot = captureRequirementSnapshot(
      { materialId: 7 },
      { id: 7, name: "Cáp đồng", specText: "CV 1x10", unit: "m" },
    );

    expect(snapshot).toEqual({
      materialId: 7,
      materialName: "Cáp đồng",
      specText: "CV 1x10",
      unit: "m",
    });
  });

  it("rejects invalid quantity precision and malformed dates", () => {
    expect(() => validateRequirementQuantity(0)).toThrow();
    expect(() => validateRequirementQuantity(1.2345)).toThrow();
    expect(() => validateRequirementDate("not-a-date")).toThrow();
    expect(validateRequirementDate("2026-11-07")).toBe(
      "2026-11-07T00:00:00.000Z",
    );
  });
});
