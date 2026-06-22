import { describe, expect, it } from "vitest";

import {
  matchesQualityFilter,
  missingNcc,
  suspiciousName,
} from "~/lib/materials/scrape-product-quality";

const sampleProduct = {
  name: "CB chống giật",
  unit: "cái",
  category: "Điện",
  specText: "DN50",
  manufacturer: null,
  originCountry: "Việt Nam",
  price: 120_000,
  catalogPdfUrls: [],
};

describe("scrape-product-quality", () => {
  it("detects missing NCC and suspicious promo names", () => {
    expect(missingNcc(sampleProduct)).toBe(true);
    expect(
      suspiciousName({ ...sampleProduct, name: "Bán chạy" }),
    ).toBe(true);
  });

  it("filters products by quality flag", () => {
    expect(
      matchesQualityFilter(sampleProduct, "missingNcc", {
        hideMissingName: true,
      }),
    ).toBe(true);
    expect(
      matchesQualityFilter({ ...sampleProduct, name: "" }, "all", {
        hideMissingName: true,
      }),
    ).toBe(false);
  });
});
