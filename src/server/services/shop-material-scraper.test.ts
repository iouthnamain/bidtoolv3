import { describe, expect, it } from "vitest";

import {
  buildMaterialMetadata,
  extractPriceFromText,
  normalizeMaterialMetadata,
} from "~/lib/material-price-sources";
import { extractProductsFromPageSnapshot } from "./shop-material-scraper";

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

  it("does not infer a meter unit from Vietnamese product names", () => {
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
      unit: null,
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
