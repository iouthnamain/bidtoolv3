import { describe, expect, it } from "vitest";

import {
  ENRICHABLE_FIELDS,
  ENRICHABLE_TO_FILLABLE_FIELD,
} from "~/lib/materials/material-enrichment-types";
import { mapExtractedToFillable } from "~/server/services/enrich-web-row";

describe("ENRICHABLE_TO_FILLABLE_FIELD", () => {
  it("includes code mapped to the fillable code column", () => {
    expect(ENRICHABLE_FIELDS).toContain("code");
    expect(ENRICHABLE_TO_FILLABLE_FIELD.code).toBe("code");
  });
});

describe("mapExtractedToFillable", () => {
  it("maps all enrichable fields including code and price", () => {
    const mapped = mapExtractedToFillable(
      {
        code: { value: "CV-2x2.5", confidence: 0.9, evidence: [] },
        unit: { value: "m", confidence: 0.8, evidence: [] },
        category: { value: "Cáp", confidence: 0.7, evidence: [] },
        specText: { value: "2x2.5", confidence: 0.7, evidence: [] },
        manufacturer: { value: "CADIVI", confidence: 0.9, evidence: [] },
        originCountry: { value: "Việt Nam", confidence: 0.6, evidence: [] },
        price: { value: "1.250.000", confidence: 0.8, evidence: [] },
        sourceUrl: { value: "https://example.com/p", confidence: 0.5, evidence: [] },
      },
      ["https://example.com/p", "https://example.com/alt"],
    );

    expect(mapped.fields.code).toBe("CV-2x2.5");
    expect(mapped.fields.unit).toBe("m");
    expect(mapped.fields.category).toBe("Cáp");
    expect(mapped.fields.specText).toBe("2x2.5");
    expect(mapped.fields.manufacturer).toBe("CADIVI");
    expect(mapped.fields.originCountry).toBe("Việt Nam");
    expect(mapped.fields.defaultUnitPrice).toBe("1250000");
    expect(mapped.fields.sourceUrl).toBe("https://example.com/p");
    expect(mapped.sourceUrls).toEqual([
      "https://example.com/p",
      "https://example.com/alt",
    ]);
  });

  it("falls back sourceUrl to the first ranked hit when extraction omits it", () => {
    const mapped = mapExtractedToFillable(
      { unit: { value: "cái", confidence: 0.8, evidence: [] } },
      ["https://shop.example/item"],
    );
    expect(mapped.fields.sourceUrl).toBe("https://shop.example/item");
  });
});
