import { describe, expect, it } from "vitest";

import {
  catalogDocumentTitleFromUrl,
  catalogPdfFileNameFromUrl,
  formatCatalogPdfUrlsCell,
  isLikelyPdfUrl,
  mergeCatalogPdfUrls,
  normalizeCatalogPdfUrl,
  parseCatalogPdfUrlsCell,
} from "~/lib/materials/catalog-pdf";

describe("normalizeCatalogPdfUrl", () => {
  it("lowercases host, strips fragment and default port", () => {
    expect(
      normalizeCatalogPdfUrl("HTTPS://Shop.Example.com:443/files/Cat.pdf#page=2"),
    ).toBe("https://shop.example.com/files/Cat.pdf");
  });

  it("keeps query strings that identify the file", () => {
    expect(
      normalizeCatalogPdfUrl("https://shop.example.com/download?id=12&f=cat.pdf"),
    ).toBe("https://shop.example.com/download?id=12&f=cat.pdf");
  });

  it("returns empty string for invalid or non-http URLs", () => {
    expect(normalizeCatalogPdfUrl("not a url")).toBe("");
    expect(normalizeCatalogPdfUrl("ftp://example.com/cat.pdf")).toBe("");
    expect(normalizeCatalogPdfUrl(null)).toBe("");
    expect(normalizeCatalogPdfUrl("   ")).toBe("");
  });
});

describe("isLikelyPdfUrl", () => {
  it("detects .pdf paths case-insensitively", () => {
    expect(isLikelyPdfUrl("https://x.vn/tai-lieu/catalog.PDF")).toBe(true);
    expect(isLikelyPdfUrl("https://x.vn/catalog.pdf?v=2")).toBe(true);
  });

  it("rejects non-pdf URLs", () => {
    expect(isLikelyPdfUrl("https://x.vn/catalog.html")).toBe(false);
    expect(isLikelyPdfUrl("https://x.vn/pdf-guide")).toBe(false);
    expect(isLikelyPdfUrl("")).toBe(false);
  });
});

describe("parseCatalogPdfUrlsCell", () => {
  it("splits on newline and semicolon", () => {
    expect(
      parseCatalogPdfUrlsCell(
        "https://a.vn/1.pdf\nhttps://a.vn/2.pdf;https://a.vn/3.pdf",
      ),
    ).toEqual([
      "https://a.vn/1.pdf",
      "https://a.vn/2.pdf",
      "https://a.vn/3.pdf",
    ]);
  });

  it("dedupes by normalized URL", () => {
    expect(
      parseCatalogPdfUrlsCell(
        "https://a.vn/1.pdf\nHTTPS://A.VN/1.pdf#x; https://a.vn/1.pdf ",
      ),
    ).toEqual(["https://a.vn/1.pdf"]);
  });

  it("returns empty for blank cells", () => {
    expect(parseCatalogPdfUrlsCell(undefined)).toEqual([]);
    expect(parseCatalogPdfUrlsCell("  \n ; ")).toEqual([]);
  });
});

describe("formatCatalogPdfUrlsCell", () => {
  it("joins URLs by newline", () => {
    expect(
      formatCatalogPdfUrlsCell(["https://a.vn/1.pdf", " https://a.vn/2.pdf "]),
    ).toBe("https://a.vn/1.pdf\nhttps://a.vn/2.pdf");
  });
});

describe("mergeCatalogPdfUrls", () => {
  it("unions and dedupes across lists", () => {
    expect(
      mergeCatalogPdfUrls(
        ["https://a.vn/1.pdf"],
        ["https://a.vn/1.pdf#x", "https://a.vn/2.pdf"],
        undefined,
      ),
    ).toEqual(["https://a.vn/1.pdf", "https://a.vn/2.pdf"]);
  });
});

describe("catalog document naming", () => {
  it("derives a title from the PDF file name", () => {
    expect(
      catalogDocumentTitleFromUrl(
        "https://a.vn/files/may-bom-nuoc_catalog.pdf",
        "fallback",
      ),
    ).toBe("may bom nuoc catalog");
  });

  it("falls back when the URL has no usable file name", () => {
    expect(catalogDocumentTitleFromUrl("https://a.vn/", "Vật tư A")).toBe(
      "Vật tư A",
    );
    expect(catalogDocumentTitleFromUrl("bad url", "Vật tư A")).toBe("Vật tư A");
  });

  it("extracts a pdf file name or defaults", () => {
    expect(catalogPdfFileNameFromUrl("https://a.vn/files/cat.pdf?x=1")).toBe(
      "cat.pdf",
    );
    expect(catalogPdfFileNameFromUrl("https://a.vn/download?id=2")).toBe(
      "catalog.pdf",
    );
  });
});
