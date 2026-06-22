import { describe, expect, it } from "vitest";

import {
  buildFillPlanWithEdits,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";

function planFor(field: FillableField, cells: ReturnType<typeof buildFillPlanWithEdits>) {
  return cells.find((c) => c.field === field);
}

describe("buildFillPlanWithEdits", () => {
  it("overlays an edited value over the candidate value", () => {
    const plan = buildFillPlanWithEdits(
      { unit: "" },
      { unit: "m" },
      { unit: "mét" },
    );
    const cell = planFor("unit", plan);
    expect(cell?.action).toBe("filled");
    expect(cell?.after).toBe("mét");
  });

  it("falls back to the base value when the edit is blank", () => {
    const plan = buildFillPlanWithEdits(
      { unit: "" },
      { unit: "m" },
      { unit: "   " },
    );
    expect(planFor("unit", plan)?.after).toBe("m");
  });

  it("fills from an edit even when the base source had no value", () => {
    const plan = buildFillPlanWithEdits(
      { manufacturer: "" },
      {},
      { manufacturer: "CADIVI" },
    );
    const cell = planFor("manufacturer", plan);
    expect(cell?.action).toBe("filled");
    expect(cell?.after).toBe("CADIVI");
  });

  it("keeps a populated sheet field unless force-overwritten", () => {
    const kept = buildFillPlanWithEdits(
      { manufacturer: "Bình Minh" },
      { manufacturer: "Tiền Phong" },
      {},
    );
    expect(planFor("manufacturer", kept)?.action).toBe("kept");

    const overwritten = buildFillPlanWithEdits(
      { manufacturer: "Bình Minh" },
      { manufacturer: "Tiền Phong" },
      {},
      new Set<FillableField>(["manufacturer"]),
    );
    const cell = planFor("manufacturer", overwritten);
    expect(cell?.action).toBe("overwritten");
    expect(cell?.after).toBe("Tiền Phong");
  });

  it("overwrites a kept field with the edited value when forced", () => {
    const plan = buildFillPlanWithEdits(
      { specText: "cũ" },
      { specText: "từ web" },
      { specText: "đã sửa" },
      new Set<FillableField>(["specText"]),
    );
    const cell = planFor("specText", plan);
    expect(cell?.action).toBe("overwritten");
    expect(cell?.after).toBe("đã sửa");
  });
});
