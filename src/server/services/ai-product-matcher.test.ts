import { describe, expect, it } from "vitest";

import {
  computeManufacturerMatch,
  computeOriginMatch,
  computeScoreBreakdown,
  computeWeightedScore,
  type ScoreBreakdown,
} from "~/server/services/ai-product-matcher";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import type { materials } from "~/server/db/schema";

type MaterialRow = typeof materials.$inferSelect;

function product(
  overrides: Partial<ScrapedShopProduct> & { name: string },
): ScrapedShopProduct {
  return {
    unit: null,
    category: null,
    specText: "",
    manufacturer: null,
    originCountry: null,
    price: null,
    priceText: null,
    currency: "VND",
    sourceUrl: "https://example.com/p",
    imageUrl: null,
    sku: null,
    model: null,
    availability: null,
    ...overrides,
  } as ScrapedShopProduct;
}

function material(
  overrides: Partial<MaterialRow> & { name: string },
): MaterialRow {
  return {
    id: 1,
    unit: "cái",
    category: null,
    specText: "",
    manufacturer: null,
    originCountry: null,
    ...overrides,
  } as MaterialRow;
}

function score(
  p: ScrapedShopProduct,
  m: MaterialRow,
): {
  breakdown: ScoreBreakdown;
  total: number;
} {
  const breakdown = computeScoreBreakdown(p, m);
  return { breakdown, total: computeWeightedScore(breakdown) };
}

describe("manufacturer matching", () => {
  it("matches alias forms and casing", () => {
    expect(computeManufacturerMatch("schneider electric", "Schneider")).toBe(
      1.0,
    );
    expect(computeManufacturerMatch("Bình Minh", "BM")).toBe(1.0);
    expect(computeManufacturerMatch("HSG", "Hoa Sen")).toBe(1.0);
    expect(computeManufacturerMatch("Nhựa Tiền Phong", "TP")).toBe(1.0);
  });

  it("stays neutral when one side is missing", () => {
    expect(computeManufacturerMatch("Bosch", null)).toBe(0.5);
    expect(computeManufacturerMatch(null, null)).toBe(0.5);
  });

  it("does not match unrelated brands", () => {
    expect(computeManufacturerMatch("Bosch", "Makita")).toBeLessThan(0.5);
  });
});

describe("origin matching", () => {
  it("normalizes Vietnamese / English / abbreviation forms", () => {
    expect(computeOriginMatch("Việt Nam", "VN")).toBe(1.0);
    expect(computeOriginMatch("Vietnam", "Việt nam")).toBe(1.0);
    expect(computeOriginMatch("Trung Quốc", "China")).toBe(1.0);
    expect(computeOriginMatch("Nhật Bản", "Japan")).toBe(1.0);
  });

  it("returns 0 for different origins and 0.5 when missing", () => {
    expect(computeOriginMatch("Việt Nam", "China")).toBe(0);
    expect(computeOriginMatch("Việt Nam", null)).toBe(0.5);
  });
});

describe("full scoring — priority cases", () => {
  it("matches PVC pipe across name variations", () => {
    const p = product({
      name: "Ống nhựa PVC Ø21 Bình Minh",
      unit: "m",
      manufacturer: "Bình Minh",
    });
    const m = material({
      name: "Ống luồn dây điện PVC 21mm - Bình Minh",
      unit: "m",
      manufacturer: "Bình Minh",
    });
    const { total } = score(p, m);
    expect(total).toBeGreaterThanOrEqual(0.7);
  });

  it("recognizes shared voltage in specs", () => {
    const p = product({
      name: "Máy khoan pin 18V",
      specText: "18V, 2 pin, sạc nhanh",
    });
    const m = material({
      name: "Máy khoan dùng pin",
      specText: "Pin 18V 2.0Ah x2",
    });
    const { breakdown } = score(p, m);
    expect(breakdown.specMatch).toBeGreaterThanOrEqual(0.7);
  });

  it("rewards matching origin in the full score", () => {
    const base = {
      name: "Ống nhựa PVC 21mm",
      unit: "m",
      manufacturer: "Bình Minh",
    };
    const sameOrigin = score(
      product({ ...base, originCountry: "Việt Nam" }),
      material({ ...base, originCountry: "VN" }),
    );
    const diffOrigin = score(
      product({ ...base, originCountry: "Việt Nam" }),
      material({ ...base, originCountry: "China" }),
    );
    expect(sameOrigin.total).toBeGreaterThan(diffOrigin.total);
  });

  it("uses product code and technical spec to reach reliable profile-search range", () => {
    const { breakdown, total } = score(
      product({
        name: "Cáp điện hạ thế",
        sku: "CVV 2x2.5",
        unit: "m",
        specText: "Ruột đồng 2x2.5mm2, cách điện PVC",
      }),
      material({
        name: "Dây cáp CADIVI",
        code: "CVV-2x2.5",
        unit: "m",
        specText: "Cáp CVV ruột đồng tiết diện 2x2.5mm2 vỏ PVC",
      }),
    );

    expect(breakdown.codeMatch).toBeGreaterThanOrEqual(0.9);
    expect(total).toBeGreaterThanOrEqual(0.75);
  });

  it("caps conflicting product codes below reliable range", () => {
    const { breakdown, total } = score(
      product({
        name: "Cáp điện hạ thế",
        sku: "CVV 2x2.5",
        unit: "m",
        specText: "Ruột đồng 2x2.5mm2, cách điện PVC",
      }),
      material({
        name: "Cáp điện hạ thế CVV",
        code: "CXV-4x6",
        unit: "m",
        specText: "Cáp điện ruột đồng 4x6mm2",
      }),
    );

    expect(breakdown.codeMatch).toBe(-1);
    expect(total).toBeLessThan(0.7);
  });

  it("weights unit+spec more when both query fields are present", () => {
    const p = product({
      name: "Ống nhựa PVC",
      unit: "m",
      specText: "Ø21, độ dày 1.3mm",
    });
    const good = material({
      name: "Ống nhựa PVC",
      unit: "m",
      specText: "Ống PVC Ø21 độ dày 1.3mm",
    });
    const badUnit = material({
      name: "Ống nhựa PVC",
      unit: "cuộn",
      specText: "Ống PVC Ø21 độ dày 1.3mm",
    });
    const goodBreakdown = computeScoreBreakdown(p, good);
    const badBreakdown = computeScoreBreakdown(p, badUnit);
    const goodScore = computeWeightedScore(goodBreakdown, {
      queryHasUnit: true,
      queryHasSpec: true,
    });
    const badScore = computeWeightedScore(badBreakdown, {
      queryHasUnit: true,
      queryHasSpec: true,
    });
    expect(goodScore).toBeGreaterThan(badScore);
    expect(goodScore).toBeGreaterThanOrEqual(0.5);
  });

  it("soft-penalizes missing candidate unit/spec when query provided them", () => {
    const p = product({
      name: "Cáp CVV",
      unit: "m",
      specText: "2x2.5mm2 ruột đồng",
    });
    const complete = material({
      name: "Cáp CVV",
      unit: "m",
      specText: "2x2.5mm2 ruột đồng PVC",
    });
    const incomplete = material({
      name: "Cáp CVV",
      unit: "",
      specText: "",
    });
    const completeScore = computeWeightedScore(
      computeScoreBreakdown(p, complete),
      { queryHasUnit: true, queryHasSpec: true },
    );
    const incompleteScore = computeWeightedScore(
      computeScoreBreakdown(p, incomplete),
      { queryHasUnit: true, queryHasSpec: true },
    );
    expect(completeScore).toBeGreaterThan(incompleteScore);
  });
});
