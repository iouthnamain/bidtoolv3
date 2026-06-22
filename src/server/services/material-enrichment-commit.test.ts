import { describe, expect, it } from "vitest";

import { buildMaterialUpdatePlan } from "~/server/services/material-enrichment-commit";
import type { MaterialEnrichmentResult } from "~/lib/materials/material-enrichment-types";
import type { materials } from "~/server/db/schema";

type MaterialRow = typeof materials.$inferSelect;

function material(overrides: Partial<MaterialRow> = {}): MaterialRow {
  return {
    id: 1,
    code: null,
    name: "Cáp CV",
    unit: "m",
    category: null,
    specText: "",
    manufacturer: null,
    originCountry: null,
    defaultUnitPrice: null,
    currency: "VND",
    sourceUrl: null,
    imageUrl: null,
    metadataJson: null,
    tenantId: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as MaterialRow;
}

function result(
  fields: MaterialEnrichmentResult["fields"],
  partial: Partial<MaterialEnrichmentResult> = {},
): MaterialEnrichmentResult {
  return {
    fields,
    catalogPdfUrls: [],
    overallConfidence: 0.9,
    status: "review",
    ...partial,
  } as MaterialEnrichmentResult;
}

const NO_OPTIONS = {
  categories: [],
  manufacturers: [],
  origins: [],
  units: [],
};

describe("buildMaterialUpdatePlan — code (Mã vật tư)", () => {
  it("fills code when the material has none", () => {
    const plan = buildMaterialUpdatePlan(
      result({ code: { value: "CV-2x2.5", confidence: 0.9, evidence: [] } }),
      {},
      material({ code: null }),
      NO_OPTIONS,
    );
    const codeCell = plan.find((c) => c.field === "code");
    expect(codeCell?.action).toBe("filled");
    expect(codeCell?.after).toBe("CV-2x2.5");
  });

  it("keeps an existing code (fill-empty-only, never overwrites)", () => {
    const plan = buildMaterialUpdatePlan(
      result({ code: { value: "NEW-CODE", confidence: 0.9, evidence: [] } }),
      {},
      material({ code: "OLD-CODE" }),
      NO_OPTIONS,
    );
    const codeCell = plan.find((c) => c.field === "code");
    // Existing code present → fill-blanks-only keeps it, never overwrites.
    expect(codeCell?.after).toBe("OLD-CODE");
    expect(codeCell?.action).not.toBe("filled");
  });

  it("respects a code field lock", () => {
    const plan = buildMaterialUpdatePlan(
      result({ code: { value: "CV-2x2.5", confidence: 0.9, evidence: [] } }),
      { code: true },
      material({ code: "LOCKED-CODE" }),
      NO_OPTIONS,
    );
    const codeCell = plan.find((c) => c.field === "code");
    expect(codeCell?.action).toBe("kept");
    expect(codeCell?.after).toBe("LOCKED-CODE");
  });
});
