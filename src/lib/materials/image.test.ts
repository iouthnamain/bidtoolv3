import { describe, expect, it } from "vitest";

import {
  materialImageUrlFromScrape,
  resolveMaterialImageUrl,
} from "~/lib/materials/image";
import { buildMaterialMetadata } from "~/lib/material-price-sources";

describe("materialImageUrlFromScrape", () => {
  it("returns trimmed scrape URLs", () => {
    expect(
      materialImageUrlFromScrape("  https://shop.example.com/p/1.jpg  "),
    ).toBe("https://shop.example.com/p/1.jpg");
  });

  it("returns null for empty scrape URLs", () => {
    expect(materialImageUrlFromScrape(null)).toBeNull();
    expect(materialImageUrlFromScrape("")).toBeNull();
    expect(materialImageUrlFromScrape("   ")).toBeNull();
  });
});

describe("resolveMaterialImageUrl", () => {
  it("prefers the image_url column over metadata", () => {
    expect(
      resolveMaterialImageUrl({
        imageUrl: "https://shop.example.com/column.jpg",
        metadataJson: buildMaterialMetadata({
          priceSources: [],
          shopScrape: {
            sourceUrl: "https://shop.example.com/p/1",
            shopHost: "shop.example.com",
            scrapedAt: "2026-06-09T00:00:00.000Z",
            imageUrl: "https://shop.example.com/metadata.jpg",
            sku: null,
            model: null,
            availability: null,
            shopCategory: null,
          },
        }),
      }),
    ).toBe("https://shop.example.com/column.jpg");
  });

  it("falls back to metadata shopScrape image for legacy rows", () => {
    expect(
      resolveMaterialImageUrl({
        imageUrl: null,
        metadataJson: buildMaterialMetadata({
          priceSources: [],
          shopScrape: {
            sourceUrl: "https://shop.example.com/p/1",
            shopHost: "shop.example.com",
            scrapedAt: "2026-06-09T00:00:00.000Z",
            imageUrl: "https://shop.example.com/metadata.jpg",
            sku: null,
            model: null,
            availability: null,
            shopCategory: null,
          },
        }),
      }),
    ).toBe("https://shop.example.com/metadata.jpg");
  });

  it("returns null when no image is available", () => {
    expect(
      resolveMaterialImageUrl({
        imageUrl: null,
        metadataJson: {},
      }),
    ).toBeNull();
  });
});
