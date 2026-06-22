import { describe, expect, it } from "vitest";

import {
  applySavedMaterialToDecision,
  applyWebSearchToDecision,
  buildExportPreviewRows,
  countFieldsToFill,
  countResolvedRows,
  effectiveAcceptedFieldValues,
  isExportableDecision,
  mergeWebGapFill,
  webFieldsAfterGapFill,
  type RowDecisionLike,
} from "~/lib/materials/enrich-gap-fill";

describe("mergeWebGapFill", () => {
  it("fills all web fields when no catalog candidate", () => {
    const merged = mergeWebGapFill(
      { unit: "" },
      null,
      { unit: "m", manufacturer: "CADIVI", category: "Cáp" },
    );
    expect(merged).toEqual({
      unit: "m",
      manufacturer: "CADIVI",
      category: "Cáp",
    });
  });

  it("skips web fields the catalog already fills", () => {
    const merged = mergeWebGapFill(
      { unit: "", manufacturer: "" },
      { unit: "m", manufacturer: "Tiền Phong" },
      { unit: "mét", manufacturer: "CADIVI", category: "Cáp" },
    );
    expect(merged.unit).toBe("m");
    expect(merged.manufacturer).toBe("Tiền Phong");
    expect(merged.category).toBe("Cáp");
  });

  it("does not overwrite sheet code with web code", () => {
    const merged = mergeWebGapFill(
      { code: "ABC-123" },
      null,
      { code: "WEB-999", unit: "cái" },
    );
    expect(merged.code).toBeUndefined();
    expect(merged.unit).toBe("cái");
  });

  it("does not overwrite catalog code with web code", () => {
    const merged = mergeWebGapFill(
      { code: "" },
      { code: "CAT-1", unit: "m" },
      { code: "WEB-1", specText: "từ web" },
    );
    expect(merged.code).toBe("CAT-1");
    expect(merged.specText).toBe("từ web");
  });
});

describe("webFieldsAfterGapFill", () => {
  it("returns only web-contributed fields when catalog is selected", () => {
    const gaps = webFieldsAfterGapFill(
      { unit: "", specText: "" },
      { unit: "m" },
      { unit: "mét", specText: "4x6", manufacturer: "CADIVI" },
    );
    expect(gaps.unit).toBeUndefined();
    expect(gaps.specText).toBe("4x6");
    expect(gaps.manufacturer).toBe("CADIVI");
  });
});

describe("isExportableDecision", () => {
  it("accepts catalog-backed rows", () => {
    expect(
      isExportableDecision({
        materialId: 42,
        acceptedFields: new Set(["unit"]),
      }),
    ).toBe(true);
  });

  it("accepts web-only rows when overrides cover accepted fields", () => {
    expect(
      isExportableDecision({
        materialId: null,
        acceptedFields: new Set(["unit", "manufacturer"]),
        editedValues: { unit: "m", manufacturer: "CADIVI" },
      }),
    ).toBe(true);
  });

  it("rejects web-only rows with missing overrides", () => {
    expect(
      isExportableDecision({
        materialId: null,
        acceptedFields: new Set(["unit", "manufacturer"]),
        editedValues: { unit: "m" },
      }),
    ).toBe(false);
  });
});

describe("countFieldsToFill", () => {
  it("includes web-only rows", () => {
    const decisions: RowDecisionLike[] = [
      {
        materialId: null,
        acceptedFields: new Set(["unit", "manufacturer"]),
        editedValues: { unit: "m", manufacturer: "CADIVI" },
      },
      {
        materialId: 1,
        acceptedFields: new Set(["category"]),
      },
    ];
    expect(countFieldsToFill(decisions)).toBe(3);
  });
});

describe("countResolvedRows", () => {
  it("counts web/manual rows without catalog id", () => {
    const decisions: RowDecisionLike[] = [
      { materialId: null, acceptedFields: new Set(["unit"]) },
      { materialId: 2, acceptedFields: new Set() },
      { materialId: null, acceptedFields: new Set(), skipped: true },
    ];
    expect(countResolvedRows(decisions)).toBe(2);
  });
});

describe("applyWebSearchToDecision", () => {
  it("merges web fields, accepts gap-fill values, and marks done", () => {
    const current: RowDecisionLike = {
      materialId: null,
      acceptedFields: new Set(),
      webProposedFields: { manufacturer: "Old" },
    };
    const next = applyWebSearchToDecision(
      current,
      { unit: "", specText: "" },
      null,
      {
        fields: { unit: "m", specText: "4x6", manufacturer: "CADIVI" },
        evidence: [
          { field: "unit", value: "m", snippet: "ĐVT: m", sourceUrl: "https://x" },
        ],
      },
    );
    expect(next.webSearchStatus).toBe("done");
    expect(next.webProposedFields).toEqual({
      manufacturer: "CADIVI",
      unit: "m",
      specText: "4x6",
    });
    expect(next.acceptedFields).toEqual(
      new Set(["unit", "specText", "manufacturer"]),
    );
    expect(next.editedValues).toEqual({
      unit: "m",
      specText: "4x6",
      manufacturer: "CADIVI",
    });
    expect(next.webEvidence).toHaveLength(1);
  });

  it("preserves catalog-backed materialId and skips catalog-filled gaps", () => {
    const current: RowDecisionLike = {
      materialId: 7,
      acceptedFields: new Set(["unit"]),
      editedValues: { unit: "m" },
    };
    const next = applyWebSearchToDecision(
      current,
      { unit: "", manufacturer: "" },
      { unit: "m" },
      {
        fields: { unit: "mét", manufacturer: "CADIVI" },
        evidence: [],
      },
    );
    expect(next.materialId).toBe(7);
    expect(next.acceptedFields).toEqual(new Set(["unit", "manufacturer"]));
    expect(next.editedValues?.unit).toBe("m");
    expect(next.editedValues?.manufacturer).toBe("CADIVI");
  });
});

describe("applySavedMaterialToDecision", () => {
  it("links materialId and ticks non-empty saved fields", () => {
    const next = applySavedMaterialToDecision(42, {
      unit: "m",
      manufacturer: "CADIVI",
      code: "",
    });
    expect(next.materialId).toBe(42);
    expect(next.acceptedFields).toEqual(new Set(["unit", "manufacturer"]));
    expect(next.webProposedFields).toEqual({});
    expect(next.editedValues).toEqual({});
  });
});

describe("effectiveAcceptedFieldValues", () => {
  it("returns post-fill values for accepted fields only", () => {
    const values = effectiveAcceptedFieldValues(
      { unit: "" },
      null,
      {
        acceptedFields: new Set(["unit"]),
        editedValues: { unit: "m" },
        webProposedFields: {},
      },
    );
    expect(values.unit).toBe("m");
  });
});

describe("buildExportPreviewRows", () => {
  it("builds preview cells for exportable decisions", () => {
    const { rows, totalExportable } = buildExportPreviewRows(
      [
        {
          originalRowIndex: 5,
          name: "Cáp điện",
          sheetFields: { unit: "" },
          candidates: [],
        },
      ],
      new Map([
        [
          5,
          {
            materialId: null,
            acceptedFields: new Set(["unit"]),
            editedValues: { unit: "m" },
          },
        ],
      ]),
    );
    expect(totalExportable).toBe(1);
    expect(rows[0]?.originalRowIndex).toBe(5);
    expect(rows[0]?.cells[0]?.field).toBe("unit");
    expect(rows[0]?.cells[0]?.action).toBe("filled");
  });

  it("applies sheet edits to preview cell values", () => {
    const { rows } = buildExportPreviewRows(
      [
        {
          originalRowIndex: 5,
          name: "Cáp điện",
          sheetFields: { unit: "" },
          candidates: [],
        },
      ],
      new Map([
        [
          5,
          {
            materialId: null,
            acceptedFields: new Set(["unit"]),
            editedValues: { unit: "m" },
          },
        ],
      ]),
      { sheetEdits: { "5": { unit: "cuộn" } } },
    );
    expect(rows[0]?.cells[0]?.after).toBe("cuộn");
  });
});
