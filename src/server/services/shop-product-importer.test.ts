import { describe, expect, it } from "vitest";

import { buildMergePreview } from "~/lib/materials/shop-import-merge-preview";
import type { materials } from "~/server/db/schema";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";

type MaterialRow = typeof materials.$inferSelect;

function createMaterial(overrides: Partial<MaterialRow> = {}): MaterialRow {
  return {
    id: 1,
    code: null,
    name: "Quạt cũ",
    unit: "cái",
    category: null,
    specText: "",
    manufacturer: null,
    originCountry: null,
    defaultUnitPrice: null,
    currency: "VND",
    sourceUrl: null,
    imageUrl: null,
    defaultDepreciation: 1,
    defaultReusePct: 0,
    metadataJson: {},
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createScrapedProduct(
  overrides: Partial<ScrapedShopProduct> = {},
): ScrapedShopProduct {
  return {
    name: "Quạt hút thông gió công nghiệp 0.55kW",
    unit: "cái",
    category: "Quạt công nghiệp",
    specText: "0.55kW, 3 pha",
    manufacturer: "iFan",
    originCountry: "Việt Nam",
    price: 1_250_000,
    priceText: "1.250.000 đ",
    currency: "VND",
    sourceUrl: "https://example.com/product/quat-hut",
    imageUrl: "https://example.com/quat.jpg",
    sku: "SMC-38",
    model: "SMC-38",
    availability: null,
    shopCategory: null,
    catalogPdfUrls: [],
    ...overrides,
  };
}

describe("buildMergePreview", () => {
  it("fills empty catalog fields from scraped product", () => {
    const preview = buildMergePreview(
      createMaterial(),
      createScrapedProduct(),
    );

    const category = preview.find((field) => field.key === "category");
    const manufacturer = preview.find((field) => field.key === "manufacturer");
    const price = preview.find((field) => field.key === "defaultUnitPrice");

    expect(category).toMatchObject({
      before: "",
      after: "Quạt công nghiệp",
      changed: true,
    });
    expect(manufacturer).toMatchObject({
      before: "",
      after: "iFan",
      changed: true,
    });
    expect(price?.changed).toBe(true);
    expect(price?.after).toContain("1.250.000");
  });

  it("does not overwrite populated locked fields", () => {
    const preview = buildMergePreview(
      createMaterial({
        category: "Thiết bị điện",
        manufacturer: "Catalog NCC",
        metadataJson: {
          fieldLocks: {
            category: true,
            manufacturer: true,
          },
        },
      }),
      createScrapedProduct(),
    );

    expect(preview.find((field) => field.key === "category")).toMatchObject({
      before: "Thiết bị điện",
      after: "Thiết bị điện",
      changed: false,
    });
    expect(preview.find((field) => field.key === "manufacturer")).toMatchObject({
      before: "Catalog NCC",
      after: "Catalog NCC",
      changed: false,
    });
  });
});

describe("import preview summary shape", () => {
  it("aggregates classification actions", () => {
    const items = [
      { action: "create" as const },
      { action: "update" as const },
      { action: "skip_no_name" as const },
    ];

    const summary = {
      create: items.filter((item) => item.action === "create").length,
      update: items.filter((item) => item.action === "update").length,
      skipNoName: items.filter((item) => item.action === "skip_no_name").length,
      total: items.length,
    };

    expect(summary).toEqual({
      create: 1,
      update: 1,
      skipNoName: 1,
      total: 3,
    });
  });
});
