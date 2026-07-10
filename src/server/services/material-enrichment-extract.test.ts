import { describe, expect, it } from "vitest";

import { parseExtractionResponse } from "~/server/services/material-enrichment-extract";

describe("material enrichment extraction evidence", () => {
  it("drops an unsupported model field and keeps only valid HTTP catalog PDFs", () => {
    const parsed = parseExtractionResponse(
      JSON.stringify({
        fields: {
          manufacturer: {
            value: "Unsupported maker",
            confidence: 0.99,
            evidence: [],
          },
          originCountry: {
            value: "Việt Nam",
            confidence: 0.95,
            evidence: [
              {
                field: "originCountry",
                value: "Việt Nam",
                sourceUrl: "https://example.vn/product",
                snippet: "Xuất xứ: Việt Nam",
              },
            ],
          },
        },
        catalogPdfUrls: [
          "catalog.pdf",
          "https://example.vn/catalog/product.pdf",
          "https://example.vn/catalog/product.html",
        ],
      }),
    );

    expect(parsed.manufacturer).toMatchObject({
      value: null,
      confidence: 0,
      evidence: [],
    });
    expect(parsed.originCountry).toMatchObject({ value: "Việt Nam" });
    expect(parsed.catalogPdfUrls).toEqual([
      "https://example.vn/catalog/product.pdf",
    ]);
  });
});
