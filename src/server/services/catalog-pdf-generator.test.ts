import { describe, expect, it } from "vitest";

import { buildCatalogHtmlForTest } from "~/server/services/catalog-pdf-generator";

const baseMaterial = {
  code: "VT-001",
  name: "Ống thép mạ kẽm",
  unit: "m",
  category: "Vật tư cơ khí",
  specText: "DN50, dày 3.5mm",
  manufacturer: "Hòa Phát",
  originCountry: "Việt Nam",
  defaultUnitPrice: 1_250_000,
  sourceUrl: "https://example.com/product",
};

describe("buildCatalogHtmlForTest", () => {
  it("renders the material name and present fields", () => {
    const html = buildCatalogHtmlForTest(baseMaterial);
    expect(html).toContain("Ống thép mạ kẽm");
    expect(html).toContain("VT-001");
    expect(html).toContain("Hòa Phát");
    expect(html).toContain("DN50, dày 3.5mm");
    // Price is formatted with vi-VN grouping + currency symbol.
    expect(html).toContain("1.250.000");
  });

  it("omits rows for empty/null fields", () => {
    const html = buildCatalogHtmlForTest({
      ...baseMaterial,
      category: null,
      manufacturer: "   ",
      defaultUnitPrice: null,
    });
    expect(html).not.toContain("Nhóm</th>");
    expect(html).not.toContain("Nhà sản xuất</th>");
    expect(html).not.toContain("Đơn giá</th>");
    // Still renders the fields that are present.
    expect(html).toContain("Xuất xứ");
  });

  it("escapes HTML in field values to prevent injection", () => {
    const html = buildCatalogHtmlForTest({
      ...baseMaterial,
      name: '<script>alert("x")</script>',
      specText: "a < b & c > d",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &lt; b &amp; c &gt; d");
  });

  it("falls back to a default title when name is blank", () => {
    const html = buildCatalogHtmlForTest({ ...baseMaterial, name: "  " });
    expect(html).toContain("<h1>Vật tư</h1>");
  });

  it("converts spec newlines to <br>", () => {
    const html = buildCatalogHtmlForTest({
      ...baseMaterial,
      specText: "line1\nline2",
    });
    expect(html).toContain("line1<br>line2");
  });
});
