import { describe, expect, it } from "vitest";

import { buildSearchQueries } from "./query-builder";

describe("buildSearchQueries", () => {
  it("uses sku/model identifiers and falls back to name queries", () => {
    const queries = buildSearchQueries({
      name: "Máy cắt bê tông",
      sku: "SKU-123",
      model: "MCB-500",
      maxQueries: 5,
    });

    expect(queries.some((query) => query.query.includes("SKU-123"))).toBe(true);
    expect(
      queries.some((query) => query.query.includes("Máy cắt bê tông")),
    ).toBe(true);
  });

  it("adds VN procurement queries for manufacturer and category", () => {
    const queries = buildSearchQueries({
      name: "Ống PVC D90",
      manufacturer: "Bình Minh",
      code: "PVC-D90",
      category: "ống nhựa",
      unit: "m",
      maxQueries: 6,
    });

    const joined = queries.map((query) => query.query).join("\n");
    expect(joined).toContain("thông số kỹ thuật");
    expect(joined).toContain("bảng giá");
    expect(queries.some((query) => query.intent === "vn_pdf")).toBe(true);
    expect(queries.length).toBeLessThanOrEqual(6);
  });

  it("adds site:.vn and negative marketplace variants when enabled", () => {
    const queries = buildSearchQueries(
      {
        name: "Ống nhựa Bình Minh D90",
        manufacturer: "Bình Minh",
      },
      {
        context: "excel_research",
        queryControls: {
          enableSiteVnVariants: true,
          enableNegativeMarketplaceVariants: true,
          materialJobMaxQueries: 4,
          excelResearchMaxQueries: 8,
          interactiveMaxQueries: 6,
        },
        domainPolicy: {
          boostDomains: ["binhminhplastic.com.vn"],
          penaltyDomains: ["shopee.vn", "lazada.vn"],
          blockDomains: [],
        },
      },
    );

    const joined = queries.map((query) => query.query).join("\n");
    expect(joined).toContain("site:.vn");
    expect(joined).toContain("-site:shopee.vn");
    expect(joined).toContain("-site:lazada.vn");
  });

  it("respects max query count by context", () => {
    const queries = buildSearchQueries(
      {
        name: "Dây cáp điện Cadivi CVV 2x2.5",
        manufacturer: "Cadivi",
        code: "CVV 2x2.5",
      },
      {
        context: "material_job",
        queryControls: {
          enableSiteVnVariants: true,
          enableNegativeMarketplaceVariants: true,
          materialJobMaxQueries: 4,
          excelResearchMaxQueries: 6,
          interactiveMaxQueries: 6,
        },
      },
    );

    expect(queries).toHaveLength(4);
  });
});
