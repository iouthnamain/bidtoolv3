import { describe, expect, it } from "vitest";

import {
  acceptedEnrichmentFields,
  resolveEnrichmentFieldProposal,
} from "~/lib/materials/material-enrichment-commit-decision";
import type { MaterialEnrichmentResult } from "~/lib/materials/material-enrichment-types";

function result(
  partial: Partial<MaterialEnrichmentResult>,
): Pick<MaterialEnrichmentResult, "fields" | "accepted_fields" | "edited_fields"> {
  return {
    fields: {},
    ...partial,
  } as MaterialEnrichmentResult;
}

describe("resolveEnrichmentFieldProposal", () => {
  it("uses the extracted value when no decision is set", () => {
    const r = result({
      fields: {
        manufacturer: { value: "CADIVI", confidence: 0.9, evidence: [] },
      },
    });
    expect(resolveEnrichmentFieldProposal(r, "manufacturer")).toBe("CADIVI");
  });

  it("prefers matchedOption over raw value", () => {
    const r = result({
      fields: {
        category: {
          value: "day dien",
          matchedOption: "Dây điện",
          confidence: 0.8,
          evidence: [],
        },
      },
    });
    expect(resolveEnrichmentFieldProposal(r, "category")).toBe("Dây điện");
  });

  it("gates out fields not in accepted_fields", () => {
    const r = result({
      fields: {
        manufacturer: { value: "CADIVI", confidence: 0.9, evidence: [] },
        unit: { value: "m", confidence: 0.9, evidence: [] },
      },
      accepted_fields: ["unit"],
    });
    expect(resolveEnrichmentFieldProposal(r, "unit")).toBe("m");
    // manufacturer not accepted → undefined (skip).
    expect(resolveEnrichmentFieldProposal(r, "manufacturer")).toBeUndefined();
  });

  it("applies an inline edit over the extracted value", () => {
    const r = result({
      fields: {
        manufacturer: { value: "CADIVI", confidence: 0.9, evidence: [] },
      },
      accepted_fields: ["manufacturer"],
      edited_fields: { manufacturer: "CADIVI (chính hãng)" },
    });
    expect(resolveEnrichmentFieldProposal(r, "manufacturer")).toBe(
      "CADIVI (chính hãng)",
    );
  });

  it("ignores a blank edit and keeps the extracted value", () => {
    const r = result({
      fields: { unit: { value: "m", confidence: 0.9, evidence: [] } },
      edited_fields: { unit: "   " },
    });
    expect(resolveEnrichmentFieldProposal(r, "unit")).toBe("m");
  });
});

describe("acceptedEnrichmentFields", () => {
  it("returns all fields when no decision is set", () => {
    expect(acceptedEnrichmentFields(result({})).length).toBeGreaterThan(0);
  });

  it("returns only the accepted subset in canonical order", () => {
    expect(
      acceptedEnrichmentFields(result({ accepted_fields: ["unit", "price"] })),
    ).toEqual(["unit", "price"]);
  });
});
