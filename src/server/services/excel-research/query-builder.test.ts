import { describe, expect, it } from "vitest";

import { buildSearchQueries } from "./query-builder";

describe("buildSearchQueries", () => {
  it("builds richer deduplicated material search queries", () => {
    const queries = buildSearchQueries({
      name: "Ống nhựa PVC D90",
      manufacturer: "Bình Minh",
      code: "PVC-D90",
      specText: "ống cấp thoát nước áp lực cao màu xanh",
      maxQueries: 4,
    });

    expect(queries.map((query) => query.intent)).toContain("pdf");
    expect(queries.map((query) => query.query).join("\n")).toContain(
      "Bình Minh",
    );
    expect(queries.length).toBeLessThanOrEqual(4);
  });

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
});
