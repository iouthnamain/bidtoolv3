import { describe, expect, it } from "vitest";

import {
  buildMaterialMetadata,
  extractPriceFromText,
  normalizeMaterialMetadata,
} from "~/lib/material-price-sources";
import {
  enrichProductWithPageText,
  extractProductsFromPageSnapshot,
  extractProductsWithDiagnosticsFromPageSnapshot,
  isShopPromoBadgeText,
  mergeScrapedProductData,
  stripShopPromoBadgePrefix,
} from "./shop-material-scraper";
import { normalizeShopScrapeUrl } from "./shop-scrape-jobs";
import {
  normalizeManufacturer,
  normalizeOriginCountry,
} from "~/lib/materials/shop-attribute-normalize";

const CODIENHAIAU_CATEGORY_URL =
  "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/";

const CODIENHAIAU_EXPECTED_PRODUCTS = [
  {
    name: "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
    href: "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
    text: "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm 700.000 ₫",
    cardName: "Thịnh thành",
  },
  {
    name: "Đồng hồ đo tần số Selec MF16 96x48mm",
    href: "https://codienhaiau.com/product/dong-ho-do-tan-so-selec-mf16/",
    text: "Đồng hồ đo tần số Selec MF16 96x48mm 277.000 ₫",
    cardName: "Đồng hồ đo tần số Selec MF16 96x48mm",
  },
  {
    name: "Đồng hồ đo tần số Selec MF316 96x96mm",
    href: "https://codienhaiau.com/product/dong-ho-do-tan-so-selec-mf316/",
    text: "Đồng hồ đo tần số Selec MF316 96x96mm 284.000 ₫",
    cardName: "Đồng hồ đo tần số Selec MF316 96x96mm",
  },
  {
    name: "Đồng hồ đo tần số Selec MF216 72x72mm",
    href: "https://codienhaiau.com/product/dong-ho-do-tan-so-selec-mf216/",
    text: "Đồng hồ đo tần số Selec MF216 72x72mm 284.000 ₫",
    cardName: "Đồng hồ đo tần số Selec MF216 72x72mm",
  },
  {
    name: "Đồng hồ đo đa năng Selec VAF39A 96x96mm",
    href: "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf39a-96x96mm/",
    text: "Thịnh thành Đồng hồ đo đa năng Selec VAF39A 96x96mm 974.000 ₫",
    cardName: "Thịnh thành",
  },
  {
    name: "Đồng hồ đo tần số Taiwan Meters 72x72mm",
    href: "https://codienhaiau.com/product/dong-ho-do-tan-so-taiwan-meters-72x72mm/",
    text: "Đồng hồ đo tần số Taiwan Meters 72x72mm 489.000 ₫",
    cardName: "Đồng hồ đo tần số Taiwan Meters 72x72mm",
  },
  {
    name: "Đồng hồ đo tần số Taiwan Meters 96x96mm",
    href: "https://codienhaiau.com/product/dong-ho-do-tan-so-taiwan-meters-96x96mm/",
    text: "Đồng hồ đo tần số Taiwan Meters 96x96mm 627.000 ₫",
    cardName: "Đồng hồ đo tần số Taiwan Meters 96x96mm",
  },
  {
    name: "Đồng hồ đo tần số Selec MA316 96x96mm",
    href: "https://codienhaiau.com/product/dong-ho-do-tan-so-selec-ma316/",
    text: "Đồng hồ đo tần số Selec MA316 96x96mm 271.000 ₫",
    cardName: "Đồng hồ đo tần số Selec MA316 96x96mm",
  },
] as const;

describe("extractProductsFromPageSnapshot", () => {
  it("extracts all 8 codienhaiau category products and ignores sidebar duplicates", () => {
    const mainCards = CODIENHAIAU_EXPECTED_PRODUCTS.map((product) => ({
      name: product.cardName,
      href: product.href,
      imageUrl: null,
      category: null,
      text: product.text,
    }));
    const sidebarCards = CODIENHAIAU_EXPECTED_PRODUCTS.map((product) => ({
      name: product.name,
      href: product.href,
      imageUrl: null,
      category: null,
      text: `${product.text} sidebar`,
    }));

    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: CODIENHAIAU_CATEGORY_URL,
        title: "Đồng hồ đo tần số",
        jsonLdTexts: [],
        cards: [...mainCards, ...sidebarCards],
        nextLinks: [],
      },
      "dom_cards",
    );

    expect(products).toHaveLength(8);
    expect(products.map((product) => product.name).sort()).toEqual(
      CODIENHAIAU_EXPECTED_PRODUCTS.map((product) => product.name).sort(),
    );
    for (const product of products) {
      expect(product.sourceUrl).toMatch(/\/product\//);
      expect(product.name).not.toMatch(/^Thịnh thành$/);
    }
  });

  it("extracts codienhaiau promo badge titles when badge is on its own line", () => {
    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: CODIENHAIAU_CATEGORY_URL,
        title: "Đồng hồ đo tần số",
        jsonLdTexts: [],
        cards: [
          {
            name: "Thịnh thành",
            href: "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
            imageUrl: null,
            category: null,
            text: "Thịnh thành\nĐồng hồ đo đa năng Selec VAF36A 96x96mm\n700.000 ₫",
          },
          {
            name: "Thịnh thành",
            href: "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf39a-96x96mm/",
            imageUrl: null,
            category: null,
            text: "Thịnh thành\nĐồng hồ đo đa năng Selec VAF39A 96x96mm\n974.000 ₫",
          },
        ],
        nextLinks: [],
      },
      "dom_cards",
    );

    expect(products).toHaveLength(2);
    expect(products.map((product) => product.name).sort()).toEqual(
      [
        "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
        "Đồng hồ đo đa năng Selec VAF39A 96x96mm",
      ].sort(),
    );
  });

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

  it("merges incomplete JSON-LD fields into the DOM product URL", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/category/tools/",
      title: "Tools",
      jsonLdTexts: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Máy khoan pin 18V",
          description: "Máy khoan pin 18V, 2 pin, sạc nhanh.",
          brand: { name: "Makita" },
          category: "Dụng cụ điện",
          offers: {
            price: "2100000",
            priceCurrency: "VND",
          },
        }),
      ],
      cards: [
        {
          name: "Máy khoan pin 18V",
          href: "https://shop.example.com/product/may-khoan-pin-18v/",
          imageUrl: null,
          category: null,
          text: "Máy khoan pin 18V 2.050.000 đ",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Máy khoan pin 18V",
      sourceUrl: "https://shop.example.com/product/may-khoan-pin-18v/",
      manufacturer: "Makita",
      category: "Dụng cụ điện",
      specText: "Máy khoan pin 18V, 2 pin, sạc nhanh.",
    });
  });

  it("keeps valid listing cards when price is missing or contact-only", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/category/tools/",
      title: "Tools",
      jsonLdTexts: [],
      cards: [
        {
          name: "Máy cắt cầm tay Bosch GWS 060",
          href: "https://shop.example.com/product/may-cat-bosch-gws-060/",
          imageUrl: null,
          category: "Dụng cụ điện",
          text: "Máy cắt cầm tay Bosch GWS 060 Liên hệ Còn hàng",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Máy cắt cầm tay Bosch GWS 060",
      price: null,
      priceText: null,
      sourceUrl: "https://shop.example.com/product/may-cat-bosch-gws-060/",
    });
  });

  it("drops generic category/nav anchors that have no product evidence", () => {
    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: "https://www.thegioiic.com/",
        title: "Thegioiic",
        jsonLdTexts: [],
        cards: [
          {
            name: "IC - Mạch Tích Hợp",
            href: "https://www.thegioiic.com/san-pham/ic-mach-tich-hop",
            imageUrl: null,
            category: null,
            text: "IC - Mạch Tích Hợp",
            extractSource: "generic_anchor",
            nameSource: "anchor_text",
          },
          {
            name: "Mạch Giảm Áp DC-DC Mini560 5A",
            href: "https://caka.vn/mach-giam-ap-dc-dc-mini560-5a",
            imageUrl: null,
            category: null,
            text: "Mạch Giảm Áp DC-DC Mini560 5A 20.000₫",
            extractSource: "generic_anchor",
            nameSource: "anchor_text",
          },
        ],
        nextLinks: [],
      },
      "dom_cards",
    );

    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe("Mạch Giảm Áp DC-DC Mini560 5A");
  });

  it("uses card text when stock count text is selected as the initial title", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://dientunguyenhien.vn/",
      title: "Điện Tử Nguyễn Hiền",
      jsonLdTexts: [],
      cards: [
        {
          name: "Còn 10 cái",
          href: "https://dientunguyenhien.vn/show/3705",
          imageUrl: null,
          category: null,
          text: "Còn 10 cái\nMạch điều khiển động cơ bước TB6600\n990,000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Mạch điều khiển động cơ bước TB6600",
      price: 990000,
      unit: null,
    });
  });

  it("reports per-card diagnostics for invalid listing URLs", () => {
    const result = extractProductsWithDiagnosticsFromPageSnapshot(
      {
        pageUrl: "https://shop.example.com/category/tools/",
        title: "Tools",
        jsonLdTexts: [],
        cards: [
          {
            name: "Máy khoan Bosch",
            href: "https://shop.example.com/category/tools/",
            imageUrl: null,
            category: null,
            text: "Máy khoan Bosch 900.000 đ",
          },
          {
            name: "Máy cắt Bosch",
            href: "https://shop.example.com/product/may-cat-bosch/",
            imageUrl: null,
            category: null,
            text: "Máy cắt Bosch 800.000 đ",
          },
        ],
        nextLinks: [],
      },
      "dom_cards",
    );

    expect(result.products).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        href: "https://shop.example.com/category/tools/",
        dropReason: "listing_page_url",
      }),
      expect.objectContaining({
        href: "https://shop.example.com/product/may-cat-bosch/",
        dropReason: null,
      }),
    ]);
  });

  it("ignores promo badge labels as product names", () => {
    expect(isShopPromoBadgeText("Thịnh thành")).toBe(true);
    expect(isShopPromoBadgeText("Thịnh hành")).toBe(true);
    expect(isShopPromoBadgeText("Bán chạy")).toBe(true);
    expect(isShopPromoBadgeText("Flash sale")).toBe(true);
    expect(isShopPromoBadgeText("Đồng hồ đo tần số Selec MF16")).toBe(false);
    expect(
      stripShopPromoBadgePrefix(
        "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm",
      ),
    ).toBe("Đồng hồ đo đa năng Selec VAF36A 96x96mm");
    expect(
      stripShopPromoBadgePrefix("Bán chạy Hot Máy khoan Bosch GSB 13RE"),
    ).toBe("Máy khoan Bosch GSB 13RE");
  });

  it("drops cards without a distinct product URL", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
      title: "Đồng hồ đo tần số",
      jsonLdTexts: [],
      cards: [
        {
          name: "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
          href: null,
          imageUrl: null,
          category: null,
          text: "Đồng hồ đo đa năng Selec VAF36A 96x96mm 700.000 ₫",
        },
        {
          name: "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
          href: "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
          imageUrl: null,
          category: null,
          text: "Đồng hồ đo đa năng Selec VAF36A 96x96mm 700.000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(0);
  });

  it("drops cards whose name is only a promo badge", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
      title: "Đồng hồ đo tần số",
      jsonLdTexts: [],
      cards: [
        {
          name: "Thịnh thành",
          href: "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
          imageUrl: null,
          category: null,
          text: "Thịnh thành 700.000 ₫",
        },
        {
          name: "Bán chạy",
          href: "https://codienhaiau.com/product/example/",
          imageUrl: null,
          category: null,
          text: "Bán chạy 120.000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(0);
  });

  it("keeps products when card name is promo-only but card text has the real title", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
      title: "Đồng hồ đo tần số",
      jsonLdTexts: [],
      cards: [
        {
          name: "Thịnh thành",
          href: "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
          imageUrl: null,
          category: null,
          text: "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm 700.000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
      price: 700000,
      sourceUrl:
        "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
    });
  });

  it("strips trailing price from codienhaiau card names", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
      title: "Đồng hồ đo tần số",
      jsonLdTexts: [],
      cards: [
        {
          name: "Đồng hồ đo tần số Selec MF16 96x48mm 277.000 ₫",
          href: "https://codienhaiau.com/product/dong-ho-do-tan-so-selec-mf16/",
          imageUrl: null,
          category: null,
          text: "Đồng hồ đo tần số Selec MF16 96x48mm 277.000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products[0]?.name).toBe("Đồng hồ đo tần số Selec MF16 96x48mm");
  });

  it("strips leading promo badges from codienhaiau-style product cards", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
      title: "Đồng hồ đo tần số",
      jsonLdTexts: [],
      cards: [
        {
          name: "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm",
          href: "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
          imageUrl: null,
          category: null,
          text: "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm 700.000 ₫",
        },
        {
          name: "Đồng hồ đo tần số Selec MF16 96x48mm",
          href: "https://codienhaiau.com/product/dong-ho-do-tan-so-selec-mf16/",
          imageUrl: null,
          category: null,
          text: "Đồng hồ đo tần số Selec MF16 96x48mm 277.000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      name: "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
      price: 700000,
      sourceUrl:
        "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
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
      name: "Vinasemi 948DB+ II Máy Hàn Trạm Điều Chỉnh Nhiệt Độ 75W, 220VAC, 200-480°C",
      price: 807120,
      priceText: "807.120 đ",
      unit: "máy",
      currency: "VND",
      imageUrl: "https://file.thegioiic.com/upload/medium/55894.jpg",
    });
  });

  it("does not infer units from metric model/thread tokens or Vietnamese word suffixes", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://icdayroi.com/",
      title: "IC Đây Rồi",
      jsonLdTexts: [],
      cards: [
        {
          name: "Tán M2.5 (gói 10 con)",
          href: "https://icdayroi.com/tan-m2-5-goi-10-con",
          imageUrl: null,
          category: null,
          text: "Tán M2.5 (gói 10 con) 2.000₫",
        },
        {
          name: "Nguồn LED 12V 100W 8.5A chống nước HPV-100-12V",
          href: "https://caka.vn/nguon-led-12v-100w-8-5a-chong-nuoc-hpv-100-12v",
          imageUrl: null,
          category: null,
          text: "Nguồn LED 12V 100W 8.5A chống nước HPV-100-12V 898.700₫",
        },
        {
          name: "Bộ 22 loại tụ gốm thông dụng 6pF~0.1uF",
          href: "https://hshop.vn/bo-22-loai-tu-gom-thong-dung",
          imageUrl: null,
          category: null,
          text: "Bộ 22 loại tụ gốm thông dụng 6pF~0.1uF 40.000₫",
        },
      ],
      nextLinks: [],
    });

    expect(products.map((product) => product.unit)).toEqual([
      "con",
      null,
      "bộ",
    ]);
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

  it("extracts manufacturer/origin from structured card spec pairs over flattened text", () => {
    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: "https://shop.example.com/category/tools/",
        title: "Tools",
        jsonLdTexts: [],
        cards: [
          {
            name: "Cảm biến áp suất Autonics",
            href: "https://shop.example.com/product/cam-bien-ap-suat-autonics/",
            imageUrl: null,
            category: null,
            text: "Cảm biến áp suất Autonics 1.200.000 đ",
            specPairs: [
              { label: "Nhà sản xuất", value: "Autonics" },
              { label: "Xuất xứ", value: "Hàn Quốc" },
              { label: "Mã hàng", value: "PSAN-1CPV" },
            ],
          },
        ],
        nextLinks: [],
      },
      "dom_cards",
    );

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      manufacturer: "Autonics",
      originCountry: "Hàn Quốc",
      sku: "PSAN-1CPV",
    });
  });

  it("fills missing fields from page-level spec pairs (detail page table/dl)", () => {
    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: "https://shop.example.com/product/bo-nguon-omron/",
        title: "Bộ nguồn Omron S8VK",
        jsonLdTexts: [],
        cards: [
          {
            name: "Bộ nguồn Omron S8VK",
            href: "https://shop.example.com/product/bo-nguon-omron/",
            imageUrl: null,
            category: null,
            text: "Bộ nguồn Omron S8VK 980.000 đ",
          },
        ],
        nextLinks: [],
        specPairs: [
          { label: "Nơi sản xuất", value: "Nhật Bản" },
          { label: "Thương hiệu", value: "Omron" },
        ],
      },
      "dom_cards",
    );

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      manufacturer: "Omron",
      originCountry: "Nhật Bản",
    });
  });

  it("does NOT smear page-level spec pairs across a multi-product listing page", () => {
    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: "https://shop.example.com/category/bo-nguon/",
        title: "Bộ nguồn",
        jsonLdTexts: [],
        cards: [
          {
            name: "Bộ nguồn Omron S8VK",
            href: "https://shop.example.com/product/bo-nguon-omron/",
            imageUrl: null,
            category: null,
            text: "Bộ nguồn Omron S8VK 980.000 đ",
          },
          {
            name: "Bộ nguồn Khác KX-100",
            href: "https://shop.example.com/product/bo-nguon-kx/",
            imageUrl: null,
            category: null,
            text: "Bộ nguồn Khác KX-100 450.000 đ",
          },
        ],
        nextLinks: [],
        // Document-level pairs are a mix of every card on a listing page; they
        // must not be used to fill products that are individually missing the
        // field, or the first card's origin/manufacturer leaks onto the rest.
        specPairs: [
          { label: "Nơi sản xuất", value: "Nhật Bản" },
          { label: "Thương hiệu", value: "Omron" },
        ],
      },
      "dom_cards",
    );

    expect(products).toHaveLength(2);
    // No product should receive the page-level Omron/Nhật Bản values just
    // because it was missing them.
    for (const product of products) {
      expect(product.manufacturer).toBeNull();
      expect(product.originCountry).toBeNull();
    }
  });

  it("extracts NCC/Xuất xứ from JSON-LD additionalProperty", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/product/khoi-dong-tu-ls",
      title: "Khởi động từ LS",
      jsonLdTexts: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Khởi động từ LS MC-12b",
          offers: {
            price: "320000",
            priceCurrency: "VND",
            url: "/product/khoi-dong-tu-ls",
          },
          additionalProperty: [
            { "@type": "PropertyValue", name: "Nhà cung cấp", value: "LS" },
            { "@type": "PropertyValue", name: "Xuất xứ", value: "Hàn Quốc" },
            { "@type": "PropertyValue", name: "Mã SP", value: "MC-12B" },
          ],
        }),
      ],
      cards: [],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Khởi động từ LS MC-12b",
      manufacturer: "LS",
      originCountry: "Hàn Quốc",
      sku: "MC-12B",
    });
  });

  it("recognizes expanded labels and stops a label value at the next field", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/product/aptomat-ls/",
      title: "Aptomat LS",
      jsonLdTexts: [],
      cards: [
        {
          name: "Aptomat LS ABE53b",
          href: "https://shop.example.com/product/aptomat-ls/",
          imageUrl: null,
          category: null,
          text: "Aptomat LS ABE53b Made in Hàn Quốc Nhãn hiệu LS Sản xuất tại Hàn Quốc Bảo hành 12 tháng 450.000 đ",
        },
      ],
      nextLinks: [],
    });

    expect(products).toHaveLength(1);
    // "Nhãn hiệu LS" must not bleed into the warranty / origin fragments.
    expect(products[0]?.manufacturer).toBe("LS");
    expect(products[0]?.originCountry).toBe("Hàn Quốc");
  });
});

describe("attribute normalization", () => {
  it("maps high-confidence origin synonyms", () => {
    expect(normalizeOriginCountry("tq")).toBe("Trung Quốc");
    expect(normalizeOriginCountry("Trung Quoc")).toBe("Trung Quốc");
    expect(normalizeOriginCountry("vn")).toBe("Việt Nam");
    expect(normalizeOriginCountry("made in china")).toBe("Trung Quốc");
  });

  it("strips leading origin label residue and title-cases plain values", () => {
    expect(normalizeOriginCountry("Xuất xứ: nhật bản")).toBe("Nhật Bản");
    expect(normalizeOriginCountry("made in malaysia")).toBe("Malaysia");
  });

  it("passes through unknown origins without over-normalizing", () => {
    expect(normalizeOriginCountry(null)).toBeNull();
    expect(normalizeOriginCountry("Liên minh Châu Âu (EU)")).toBe(
      "Liên minh Châu Âu (EU)",
    );
  });

  it("cleans manufacturer residue but preserves brand casing", () => {
    expect(normalizeManufacturer("  Schneider   Electric ")).toBe(
      "Schneider Electric",
    );
    expect(normalizeManufacturer("Thương hiệu: LS")).toBe("LS");
    expect(normalizeManufacturer("Bosch 1.200.000 đ")).toBe("Bosch");
    expect(normalizeManufacturer(null)).toBeNull();
  });

  it("normalizes scraped origin synonyms on extracted products", () => {
    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: "https://shop.example.com/product/tu-dien/",
        title: "Tủ điện",
        jsonLdTexts: [],
        cards: [
          {
            name: "Tủ điện công nghiệp",
            href: "https://shop.example.com/product/tu-dien/",
            imageUrl: null,
            category: null,
            text: "Tủ điện công nghiệp 5.000.000 đ",
            specPairs: [{ label: "Xuất xứ", value: "TQ" }],
          },
        ],
        nextLinks: [],
      },
      "dom_cards",
    );

    expect(products[0]?.originCountry).toBe("Trung Quốc");
  });

  it("enriches detail products from page-level spec pairs", () => {
    const sparse = {
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

    expect(
      enrichProductWithPageText(sparse, "Bộ nguồn Omron S8VK", [
        { label: "Thương hiệu", value: "Omron" },
        { label: "Xuất xứ", value: "Nhật Bản" },
      ]),
    ).toMatchObject({
      manufacturer: "Omron",
      originCountry: "Nhật Bản",
    });
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

  it("prefers the current lower price from sale/range text", () => {
    expect(
      extractPriceFromText("Giá cũ 1.200.000 đ Giá mới 980.000 đ"),
    ).toEqual({
      priceText: "980.000 đ",
      price: 980000,
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

describe("sparse product extraction", () => {
  it("keeps generic_anchor products with product detail URLs but no price", () => {
    const products = extractProductsFromPageSnapshot(
      {
        pageUrl: "https://shop.example.com/category",
        title: "Category",
        jsonLdTexts: [],
        cards: [
          {
            name: "Cảm biến nhiệt độ PT100",
            href: "https://shop.example.com/product/cam-bien-pt100/",
            imageUrl: null,
            category: null,
            text: "Cảm biến nhiệt độ PT100",
            extractSource: "generic_anchor",
            nameSource: "anchor_text",
          },
        ],
        nextLinks: [],
      },
      "dom_cards",
    );

    expect(products).toHaveLength(1);
    expect(products[0]?.price).toBeNull();
  });

  it("strips KH noise from scraped spec text", () => {
    const products = extractProductsFromPageSnapshot({
      pageUrl: "https://shop.example.com/category",
      title: "Category",
      jsonLdTexts: [],
      cards: [
        {
          name: "Đồng hồ đo điện áp",
          href: "https://shop.example.com/product/dong-ho/",
          imageUrl: null,
          category: null,
          text: "Đồng hồ đo điện áp KH 0.05 Thông số 220V 500.000 ₫",
        },
      ],
      nextLinks: [],
    });

    expect(products[0]?.specText).not.toMatch(/\bKH\b/i);
    expect(products[0]?.specText).toContain("Thông số");
  });
});
