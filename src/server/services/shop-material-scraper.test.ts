import { describe, expect, it } from "vitest";

import {
  buildMaterialMetadata,
  extractPriceFromText,
  normalizeMaterialMetadata,
} from "~/lib/material-price-sources";
import {
  enrichProductWithPageText,
  extractProductsFromPageSnapshot,
  mergeScrapedProductData,
} from "./shop-material-scraper";
import { normalizeShopScrapeUrl } from "./shop-scrape-jobs";

describe("extractProductsFromPageSnapshot", () => {
  it("extracts full product data from JSON-LD", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/category",
      title: "Shop",
      jsonLdTexts: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Máy khoan Bosch GSB 13RE",
          description: "Máy khoan động lực 650W, kèm vali.",
          sku: "GSB13RE",
          model: "GSB 13 RE",
          brand: { name: "Bosch" },
          category: "Dụng cụ điện",
          image: "/images/gsb.jpg",
          offers: {
            price: "1450000",
            priceCurrency: "VND",
            availability: "https://schema.org/InStock",
            url: "/may-khoan-bosch-gsb-13re",
          },
        }),
      ],
      cards: [],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Máy khoan Bosch GSB 13RE",
      category: "Dụng cụ điện",
      manufacturer: "Bosch",
      price: 1450000,
      currency: "VND",
      sourceUrl: "https://shop.example.com/may-khoan-bosch-gsb-13re",
      imageUrl: "https://shop.example.com/images/gsb.jpg",
      sku: "GSB13RE",
      model: "GSB 13 RE",
      availability: "https://schema.org/InStock",
    });
  });

  it("extracts a product from a generic card snapshot", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/tools",
      title: "Tools",
      jsonLdTexts: [],
      cards: [
        {
          name: "Kìm điện 8 inch",
          href: "https://shop.example.com/kim-dien-8-inch",
          imageUrl: "https://shop.example.com/kim.jpg",
          category: "Dụng cụ cầm tay",
          text: "Kìm điện 8 inch SKU: KIM-8 Giá: 85.000 vnđ Còn hàng",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Kìm điện 8 inch",
      price: 85000,
      priceText: "85.000 vnđ",
      currency: "VND",
      sku: "KIM-8",
      availability: "in_stock",
      shopCategory: "Dụng cụ cầm tay",
    });
  });

  it("carries detected catalog PDF links from card snapshots", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/tools",
      title: "Tools",
      jsonLdTexts: [],
      cards: [
        {
          name: "Máy bơm nước Panasonic GP-129JXK",
          href: "https://shop.example.com/may-bom-panasonic",
          imageUrl: null,
          category: null,
          text: "Máy bơm nước Panasonic GP-129JXK Giá: 1.550.000 đ",
          pdfUrls: [
            "https://shop.example.com/files/gp-129jxk-catalog.pdf",
            "https://shop.example.com/files/GP-129JXK-CATALOG.pdf#page=1",
          ],
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]?.catalogPdfUrls).toEqual([
      "https://shop.example.com/files/gp-129jxk-catalog.pdf",
      "https://shop.example.com/files/GP-129JXK-CATALOG.pdf#page=1",
    ]);
  });

  it("dedupes catalog PDF links that normalize to the same URL", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/tools",
      title: "Tools",
      jsonLdTexts: [],
      cards: [
        {
          name: "Máy bơm nước Panasonic GP-129JXK",
          href: "https://shop.example.com/may-bom-panasonic",
          imageUrl: null,
          category: null,
          text: "Máy bơm nước Panasonic GP-129JXK Giá: 1.550.000 đ",
          pdfUrls: [
            "https://shop.example.com/files/catalog.pdf",
            "https://shop.example.com/files/catalog.pdf#download",
            "HTTPS://SHOP.EXAMPLE.COM/files/catalog.pdf",
          ],
        },
      ],
      nextLinks: [],
    });

    expect(products[0]?.catalogPdfUrls).toEqual([
      "https://shop.example.com/files/catalog.pdf",
    ]);
  });

  it("extracts Vietnamese NCC, origin, SKU, model and category labels from DOM cards", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/tools",
      title: "Tools",
      jsonLdTexts: [],
      cards: [
        {
          name: "CB chống giật Schneider iC60",
          href: "https://shop.example.com/cb-chong-giat",
          imageUrl: null,
          category: null,
          text: "CB chống giật Schneider iC60 Giá: 450.000 đ NCC: Schneider Xuất xứ: Pháp Mã hàng: A9R11225 Model: iC60 Nhóm: Điện dân dụng Còn hàng",
        },
      ],
      nextLinks: [],
    });

    expect(products[0]).toMatchObject({
      manufacturer: "Schneider",
      originCountry: "Pháp",
      sku: "A9R11225",
      model: "iC60",
      category: "Điện dân dụng",
      availability: "in_stock",
    });
  });

  it("prefers richer duplicate product data over sparse card data", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/tools",
      title: "Tools",
      jsonLdTexts: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Máy khoan pin 18V",
          description: "Máy khoan pin 18V, 2 pin, sạc nhanh.",
          brand: { name: "Makita" },
          category: "Dụng cụ điện",
          countryOfOrigin: "Nhật Bản",
          offers: {
            price: "2100000",
            priceCurrency: "VND",
            url: "/may-khoan-pin-18v",
          },
        }),
      ],
      cards: [
        {
          name: "Máy khoan pin 18V",
          href: "https://shop.example.com/may-khoan-pin-18v",
          imageUrl: null,
          category: null,
          text: "Máy khoan pin 18V 2.100.000 đ",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      manufacturer: "Makita",
      originCountry: "Nhật Bản",
      category: "Dụng cụ điện",
      specText: "Máy khoan pin 18V, 2 pin, sạc nhanh.",
    });
  });

  it("detects material-specific units without inferring meter from model names", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://codienhaiau.com/",
      title: "Cơ Điện Hải Âu",
      jsonLdTexts: [],
      cards: [
        {
          name: "Mô đun ngõ vào LS XBE-AC08A",
          href: "https://codienhaiau.com/product/mo-dun-ngo-vao-ls-xbe-ac08a/",
          imageUrl:
            "https://codienhaiau.com/wp-content/uploads/2026/06/mo-dun-ngo-vao-ls-xbe-ac08a.jpg",
          category: null,
          text: "Mô đun ngõ vào LS XBE-AC08A 1.544.000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products[0]).toMatchObject({
      name: "Mô đun ngõ vào LS XBE-AC08A",
      price: 1544000,
      unit: "mô đun",
      imageUrl:
        "https://codienhaiau.com/wp-content/uploads/2026/06/mo-dun-ngo-vao-ls-xbe-ac08a.jpg",
    });
  });

  it("extracts Thegioiic-style plain dong price and slash unit", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://www.thegioiic.com/",
      title: "Thegioiic",
      jsonLdTexts: [],
      cards: [
        {
          name: "Vinasemi 948DB+ II Máy Hàn Trạm Điều Chỉnh Nhiệt Độ 75W, 220VAC, 200-480°C",
          href: "https://www.thegioiic.com/vinasemi-948db-ii-may-han-tram-dieu-chinh-nhiet-do-75w-220vac-200-480-c",
          imageUrl: "https://file.thegioiic.com/upload/medium/55894.jpg",
          category: null,
          text: "BH 6 tháng Vinasemi 948DB+ II Máy Hàn Trạm Điều Chỉnh Nhiệt Độ 75W, 220VAC, 200-480°C 807.120 đ/ Máy Hàng còn: 24",
        },
      ],
      nextLinks: [],
    });

    expect(products[0]).toMatchObject({
      price: 807120,
      priceText: "807.120 đ",
      unit: "máy",
      currency: "VND",
      imageUrl: "https://file.thegioiic.com/upload/medium/55894.jpg",
    });
  });

  it("extracts products nested inside JSON-LD item lists", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/page/1",
      title: "Tools",
      jsonLdTexts: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: [
            {
              "@type": "ListItem",
              item: {
                "@type": "Product",
                name: "Máy cắt sắt 2200W",
                offers: {
                  price: "2450000",
                  priceCurrency: "VND",
                  url: "/may-cat-sat-2200w",
                },
              },
            },
          ],
        }),
      ],
      cards: [],
      nextLinks: ["https://shop.example.com/page/2"],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Máy cắt sắt 2200W",
      price: 2450000,
      sourceUrl: "https://shop.example.com/may-cat-sat-2200w",
    });
  });

  it("supports JSON-LD-only and DOM-card-only scrape methods", () => {
    const snapshot = {
      pageUrl: "https://shop.example.com/tools",
      title: "Tools",
      jsonLdTexts: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Sản phẩm schema",
          offers: {
            price: "120000",
            priceCurrency: "VND",
            url: "/schema-product",
          },
        }),
      ],
      cards: [
        {
          name: "Sản phẩm card",
          href: "https://shop.example.com/card-product",
          imageUrl: null,
          category: null,
          text: "Sản phẩm card Giá: 90.000 vnđ",
        },
      ],
      nextLinks: [],
    };

    expect(
      extractProductsFromPageSnapshot(snapshot, "json_ld").map(
        (product) => product.name,
      ),
    ).toEqual(["Sản phẩm schema"]);
    expect(
      extractProductsFromPageSnapshot(snapshot, "dom_cards").map(
        (product) => product.name,
      ),
    ).toEqual(["Sản phẩm card"]);
    expect(
      extractProductsFromPageSnapshot(snapshot, "auto").map(
        (product) => product.name,
      ),
    ).toEqual(["Sản phẩm schema", "Sản phẩm card"]);
  });
});

describe("normalizeShopScrapeUrl", () => {
  it("normalizes equivalent shop URLs for active duplicate checks", () => {
    expect(
      normalizeShopScrapeUrl(
        "HTTPS://User:Pass@Shop.Example.com/tools///?b=2&a=1#top",
      ),
    ).toBe("https://shop.example.com/tools?a=1&b=2");
  });

  it("rejects non-http URLs before queue insert", () => {
    expect(() => normalizeShopScrapeUrl("file:///tmp/catalog.html")).toThrow(
      "Chỉ hỗ trợ URL shop http hoặc https.",
    );
  });
});

describe("scraped product enrichment", () => {
  const sparseProduct = {
    name: "Bộ nguồn Omron S8VK",
    unit: null,
    category: null,
    specText: "",
    manufacturer: null,
    originCountry: null,
    price: 980000,
    priceText: "980.000 đ",
    currency: "VND",
    sourceUrl: "https://shop.example.com/bo-nguon-omron-s8vk",
    imageUrl: null,
    sku: null,
    model: null,
    availability: null,
    shopCategory: null,
    catalogPdfUrls: [],
  };

  it("fills missing fields from product detail page text", () => {
    expect(
      enrichProductWithPageText(
        sparseProduct,
        "Bộ nguồn Omron S8VK Giá: 980.000 đ Thương hiệu: Omron Xuất xứ: Nhật Bản Mã hàng: S8VK-C06024 Model: S8VK Thông số kỹ thuật nguồn 24VDC 2.5A Còn hàng",
      ),
    ).toMatchObject({
      manufacturer: "Omron",
      originCountry: "Nhật Bản",
      sku: "S8VK-C06024",
      model: "S8VK",
      availability: "in_stock",
      specText: expect.stringContaining("Thông số kỹ thuật") as string,
    });
  });

  it("merges enriched data without dropping listing price and source", () => {
    expect(
      mergeScrapedProductData(sparseProduct, {
        ...sparseProduct,
        price: null,
        priceText: null,
        manufacturer: "Omron",
        originCountry: "Nhật Bản",
        specText: "Nguồn 24VDC 2.5A",
      }),
    ).toMatchObject({
      price: 980000,
      priceText: "980.000 đ",
      sourceUrl: "https://shop.example.com/bo-nguon-omron-s8vk",
      manufacturer: "Omron",
      originCountry: "Nhật Bản",
      specText: "Nguồn 24VDC 2.5A",
    });
  });

  it("unions catalog PDF links when merging listing and detail data", () => {
    expect(
      mergeScrapedProductData(
        {
          ...sparseProduct,
          catalogPdfUrls: ["https://shop.example.com/files/a.pdf"],
        },
        {
          ...sparseProduct,
          catalogPdfUrls: [
            "https://shop.example.com/files/a.pdf#page=2",
            "https://shop.example.com/files/b.pdf",
          ],
        },
      ).catalogPdfUrls,
    ).toEqual([
      "https://shop.example.com/files/a.pdf",
      "https://shop.example.com/files/b.pdf",
    ]);
  });
});

describe("extractPriceFromText", () => {
  it("supports plain Vietnamese dong symbol", () => {
    expect(extractPriceFromText("807.120 đ/ Máy")).toEqual({
      priceText: "807.120 đ",
      price: 807120,
    });
  });
});

describe("material shop scrape metadata", () => {
  it("normalizes scrape extras stored in material metadata", () => {
    const metadata = normalizeMaterialMetadata(
      buildMaterialMetadata({
        priceSources: [],
        shopScrape: {
          sourceUrl: "https://shop.example.com/p/1",
          shopHost: "shop.example.com",
          scrapedAt: "2026-06-09T00:00:00.000Z",
          imageUrl: "https://shop.example.com/p/1.jpg",
          sku: "SKU-1",
          model: "MODEL-1",
          availability: "in_stock",
          shopCategory: "Tools",
        },
      }),
    );

    expect(metadata.shopScrape).toEqual({
      sourceUrl: "https://shop.example.com/p/1",
      shopHost: "shop.example.com",
      scrapedAt: "2026-06-09T00:00:00.000Z",
      imageUrl: "https://shop.example.com/p/1.jpg",
      sku: "SKU-1",
      model: "MODEL-1",
      availability: "in_stock",
      shopCategory: "Tools",
    });
  });
});
