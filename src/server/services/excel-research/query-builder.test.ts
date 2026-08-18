import { describe, expect, it } from "vitest";

import { buildSearchProbeQueries, buildSearchQueries } from "./query-builder";

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

  it("uses compact model/spec variants and avoids site operators for interactive search", () => {
    const queries = buildSearchQueries(
      {
        name: "Dây điện VCm 0.5mm2",
        manufacturer: "Cadivi",
      },
      {
        context: "interactive",
        queryControls: {
          enableSiteVnVariants: true,
          enableNegativeMarketplaceVariants: true,
          materialJobMaxQueries: 4,
          excelResearchMaxQueries: 8,
          interactiveMaxQueries: 6,
        },
      },
    );

    const joined = queries.map((query) => query.query).join("\n");
    expect(joined).toContain("Dây điện VCm Cadivi");
    expect(joined).toContain("Dây điện VCm Cadivi bảng giá");
    expect(joined).toContain("Cadivi VCm 0.5mm2");
    expect(joined).toContain("Cadivi VCm 0.5 mm2");
    expect(joined).not.toContain("site:.vn");
    expect(joined).not.toContain("-site:");
    expect(queries.length).toBeLessThanOrEqual(6);
  });

  it("keeps bare and normalized identity queries within the six-query cap", () => {
    const queries = buildSearchQueries(
      {
        name: "Dây cáp điện Cadivi CVV 2x2.5",
        manufacturer: "Cadivi",
        code: "CVV 2x2.5",
      },
      {
        context: "profile_search",
        queryControls: {
          enableSiteVnVariants: true,
          enableNegativeMarketplaceVariants: true,
          materialJobMaxQueries: 4,
          excelResearchMaxQueries: 8,
          interactiveMaxQueries: 6,
        },
        domainPolicy: {
          boostDomains: ["cadivi.vn"],
          penaltyDomains: ["shopee.vn", "lazada.vn"],
          blockDomains: [],
        },
      },
    );

    const joined = queries.map((query) => query.query).join("\n");
    expect(queries[0]?.query).toBe("Dây cáp điện Cadivi CVV 2x2.5");
    expect(joined).toContain("day cap cvv Cadivi 2x2.5");
    expect(joined).toContain("-site:shopee.vn");
    expect(joined).toContain("thông số kỹ thuật catalog");
    expect(queries.length).toBeLessThanOrEqual(6);
  });

  it("keeps normalized specs when no explicit code is present", () => {
    const queries = buildSearchQueries(
      {
        name: "Dây điện VCm 0.5mm2",
        manufacturer: "Cadivi",
      },
      {
        context: "profile_search",
        queryControls: {
          enableSiteVnVariants: true,
          enableNegativeMarketplaceVariants: true,
          materialJobMaxQueries: 4,
          excelResearchMaxQueries: 8,
          interactiveMaxQueries: 6,
        },
        domainPolicy: {
          boostDomains: ["cadivi.vn"],
          penaltyDomains: ["shopee.vn", "lazada.vn"],
          blockDomains: [],
        },
      },
    );

    const joined = queries.map((query) => query.query).join("\n");
    expect(queries[0]?.query).toBe("Dây điện VCm 0.5mm2");
    expect(joined).toContain("Dây điện VCm 0.5mm²");
    expect(joined).toContain("-site:shopee.vn");
    expect(joined).not.toContain(" Cái");
    expect(queries.length).toBeLessThanOrEqual(6);
  });

  it("leads profile search with identity and broad recovery queries", () => {
    const queries = buildSearchQueries(
      {
        name: "Ống PVC D90",
        manufacturer: "Bình Minh",
        code: "PVC-D90",
        maxQueries: 6,
      },
      {
        context: "profile_search",
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

    expect(queries[0]?.query).toBe("Ống PVC D90");
    expect(queries.slice(0, 3).map((query) => query.intent)).toEqual([
      "general",
      "official",
      "general",
    ]);
    expect(queries[2]?.query).toBe("Ống PVC");
    expect(
      queries
        .slice(0, 3)
        .every((query) => !/catalog|pdf|thông số/i.test(query.query)),
    ).toBe(true);
    expect(
      queries
        .slice(0, 6)
        .some((query) =>
          ["pdf", "vn_pdf", "datasheet", "vn_spec"].includes(query.intent),
        ),
    ).toBe(true);
  });

  it("keeps non-profile query ordering unchanged", () => {
    const queries = buildSearchQueries(
      {
        name: "Ống PVC D90",
        manufacturer: "Bình Minh",
        code: "PVC-D90",
        maxQueries: 6,
      },
      { context: "interactive" },
    );

    expect(queries[0]?.intent).toBe("pdf");
    expect(queries.some((query) => query.intent === "vn_product")).toBe(false);
  });

  it("builds official-domain probes for material search tests", () => {
    const queries = buildSearchProbeQueries(
      "Ống nhựa Bình Minh D90 thông số kỹ thuật",
      8,
    );

    expect(queries).toContain("Ống nhựa Bình Minh D90 thông số kỹ thuật");
    expect(queries).toContain("Ống nhựa Bình Minh D90");
    expect(queries).toContain("binhminhplastic D90");
    expect(queries).toContain("binhminhplastic PVC D90");
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

  it("does not pollute profile identity queries with broad row fields", () => {
    const queries = buildSearchQueries(
      {
        name: "Van bướm điều khiển điện",
        manufacturer: "Kosaplus",
        code: "KE-050",
        specText: "DN50 PN16 220V",
        category: "Van công nghiệp",
        unit: "cái",
        originCountry: "Hàn Quốc",
        maxQueries: 6,
      },
      { context: "profile_search" },
    );

    expect(queries[0]?.query).toBe("Van bướm điều khiển điện");
    expect(
      queries.some(({ query }) => query.toLowerCase().includes("ke-050")),
    ).toBe(true);
    expect(
      queries.slice(0, 3).every(({ query }) => !query.includes("cái")),
    ).toBe(true);
    expect(
      queries.slice(0, 3).every(({ query }) => !query.includes("Hàn Quốc")),
    ).toBe(true);
  });

  it("puts row-7 bare and normalized enclosure names first", () => {
    const queries = buildSearchQueries(
      {
        name: "Tủ điện treo tường 600x400x200mm",
        unit: "Cái",
        category: "Điện",
        specText: "Thép sơn tĩnh điện",
        maxQueries: 6,
      },
      { context: "profile_search" },
    );
    expect(queries[0]?.query).toBe("Tủ điện treo tường 600x400x200mm");
    expect(queries[1]?.query).toBe("Tủ điện treo tường 600x400x200");
    expect(
      queries.slice(0, 3).every(({ query }) => !query.includes(" Cái")),
    ).toBe(true);
  });
});
