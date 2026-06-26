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
    expect(queries.at(-1)?.query).toContain("Máy cắt bê tông");
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
});
