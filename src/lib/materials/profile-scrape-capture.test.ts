import { describe, expect, it } from "vitest";

import {
  highestProfileScrapeSource,
  isProfilePdfSource,
  missingProfileMaterialSaveFields,
  profileSourceEligibility,
  resolveProfileScrapedProduct,
  type ProfileScrapedProduct,
} from "~/lib/materials/profile-scrape-capture";

function product(
  name: string,
  sourceUrl: string,
  overrides: Partial<ProfileScrapedProduct> = {},
): ProfileScrapedProduct {
  return {
    name,
    sourceUrl,
    unit: "cái",
    category: null,
    specText: "IP68",
    manufacturer: "Acme",
    originCountry: "VN",
    price: 1_000,
    priceText: "1.000 ₫",
    currency: "VND",
    imageUrl: null,
    sku: null,
    model: null,
    shopCategory: null,
    catalogPdfUrls: [],
    ...overrides,
  };
}

describe("profile scrape capture policy", () => {
  it("enforces the 75% source threshold for automatic and manual choices", () => {
    expect(profileSourceEligibility({ selectedScore: 0.749 }).eligible).toBe(
      false,
    );
    expect(
      profileSourceEligibility({
        selectedScore: 0.749,
        manuallySelected: true,
      }).eligible,
    ).toBe(false);
    expect(profileSourceEligibility({ selectedScore: 0.75 }).eligible).toBe(
      true,
    );
  });

  it("requires a five-point lead for an automatic source", () => {
    expect(
      profileSourceEligibility({
        selectedScore: 0.8,
        runnerUpScore: 0.751,
      }).eligible,
    ).toBe(false);
    expect(
      profileSourceEligibility({
        selectedScore: 0.8,
        runnerUpScore: 0.75,
      }).eligible,
    ).toBe(true);
    expect(
      profileSourceEligibility({
        selectedScore: 0.8,
        runnerUpScore: 0.79,
        manuallySelected: true,
      }).eligible,
    ).toBe(true);
  });

  it("selects an exact canonical product URL first", () => {
    const exact = product(
      "Máy bơm đúng",
      "https://shop.test/pump/?utm_source=x#detail",
    );
    const result = resolveProfileScrapedProduct(
      [product("Khác", "https://shop.test/other"), exact],
      "https://shop.test/pump",
      { name: "Không liên quan" },
    );
    expect(result.status).toBe("selected");
    if (result.status === "selected")
      expect(result.product.name).toBe(exact.name);
  });

  it("requires product selection when the best match lacks a five-point lead", () => {
    const result = resolveProfileScrapedProduct(
      [
        product("Máy bơm Acme A", "https://shop.test/a"),
        product("Máy bơm Acme B", "https://shop.test/b"),
      ],
      "https://shop.test/listing",
      { name: "Máy bơm Acme" },
    );
    expect(result.status).toBe("awaiting_product_selection");
  });

  it("detects PDF sources without sending them to the HTML scraper", () => {
    expect(
      isProfilePdfSource("https://example.test/catalog.PDF?download=1"),
    ).toBe(true);
    expect(isProfilePdfSource("https://example.test/product/1")).toBe(false);
  });

  it("selects the highest-ranked HTML source without a score gate", () => {
    expect(
      highestProfileScrapeSource([
        { url: "https://example.test/catalog.pdf", rankScore: 0.99 },
        { url: "https://example.test/low", rankScore: 0.2 },
        { url: "https://example.test/high", rankScore: 0.4 },
      ])?.url,
    ).toBe("https://example.test/high");
  });

  it("does not require enrichment-only fields when saving a material", () => {
    expect(
      missingProfileMaterialSaveFields({
        code: "BT-01",
        name: "Máy bơm",
        unit: "cái",
        specText: "IP68",
        sourceUrl: "https://example.test/pump",
      }),
    ).toEqual([]);
  });
});
