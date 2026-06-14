import { describe, expect, it } from "vitest";

import { buildBreadcrumbs } from "~/lib/breadcrumbs";

describe("buildBreadcrumbs", () => {
  it("returns no crumbs for the dashboard root", () => {
    expect(buildBreadcrumbs("/dashboard")).toEqual([]);
    expect(buildBreadcrumbs("/")).toEqual([]);
    expect(buildBreadcrumbs("")).toEqual([]);
  });

  it("prefixes a home crumb and marks the leaf as current", () => {
    const crumbs = buildBreadcrumbs("/search/packages");
    expect(crumbs.map((c) => c.label)).toEqual([
      "Tổng quan",
      "Tìm kiếm",
      "Gói thầu",
    ]);
    expect(crumbs.map((c) => c.href)).toEqual([
      "/dashboard",
      "/search",
      "/search/packages",
    ]);
    expect(crumbs.at(-1)?.isCurrent).toBe(true);
    expect(crumbs.slice(0, -1).every((c) => !c.isCurrent)).toBe(true);
  });

  it("builds a trail for a deep sub-page", () => {
    const crumbs = buildBreadcrumbs("/search/packages/location");
    expect(crumbs.map((c) => c.label)).toEqual([
      "Tổng quan",
      "Tìm kiếm",
      "Gói thầu",
      "Theo địa phương",
    ]);
  });

  it("resolves dynamic detail segments to a registry label", () => {
    const crumbs = buildBreadcrumbs("/materials/123");
    expect(crumbs.map((c) => c.label)).toEqual([
      "Tổng quan",
      "Sản phẩm / vật tư",
      "Chi tiết vật tư",
    ]);
    expect(crumbs.at(-1)?.href).toBe("/materials/123");
    expect(crumbs.at(-1)?.param).toBe("123");
  });

  it("handles nested dynamic sub-pages", () => {
    const crumbs = buildBreadcrumbs("/materials/123/prices");
    expect(crumbs.map((c) => c.label)).toEqual([
      "Tổng quan",
      "Sản phẩm / vật tư",
      "Chi tiết vật tư",
      "Nguồn giá",
    ]);
    expect(crumbs.map((c) => c.href)).toEqual([
      "/dashboard",
      "/materials",
      "/materials/123",
      "/materials/123/prices",
    ]);
  });

  it("prefers a literal route over a dynamic match at the same depth", () => {
    const crumbs = buildBreadcrumbs("/materials/new");
    expect(crumbs.at(-1)?.label).toBe("Thêm thủ công");
    expect(crumbs.at(-1)?.pattern).toBe("/materials/new");
  });

  it("resolves workflow detail sub-pages", () => {
    const crumbs = buildBreadcrumbs("/workflows/42/runs");
    expect(crumbs.map((c) => c.label)).toEqual([
      "Tổng quan",
      "Quy trình",
      "Chi tiết workflow",
      "Lịch sử chạy",
    ]);
  });

  it("resolves source detail pages reached from search", () => {
    const crumbs = buildBreadcrumbs("/package-details/ABC-001");
    expect(crumbs.map((c) => c.label)).toEqual([
      "Tổng quan",
      "Chi tiết gói thầu",
    ]);
    expect(crumbs.at(-1)?.param).toBe("ABC-001");
  });

  it("ignores query strings and trailing slashes", () => {
    const a = buildBreadcrumbs("/search/packages/?q=test");
    const b = buildBreadcrumbs("/search/packages");
    expect(a).toEqual(b);
  });

  it("falls back to a humanized label for unknown leaf segments", () => {
    const crumbs = buildBreadcrumbs("/materials/123/unknown-tab");
    expect(crumbs.at(-1)?.label).toBe("Unknown tab");
    expect(crumbs.at(-1)?.isCurrent).toBe(true);
    expect(crumbs.at(-1)?.href).toBe("/materials/123/unknown-tab");
  });

  it("nests the deep job route under materials/scrape", () => {
    const crumbs = buildBreadcrumbs("/materials/scrape/jobs/abc123");
    expect(crumbs.map((c) => c.label)).toEqual([
      "Tổng quan",
      "Sản phẩm / vật tư",
      "Scrape shop",
      "Chi tiết job",
    ]);
  });
});
