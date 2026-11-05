import { describe, expect, it } from "vitest";

import {
  mergeMaterialMetadata,
  normalizeMaterialMetadata,
} from "~/lib/material-price-sources";

describe("material metadata writes", () => {
  it("preserves profile provenance and unknown future keys when owned fields change", () => {
    const raw = {
      materialProfile: { source: "profile-search", confidence: 0.94 },
      futureWriter: { revision: 7, nested: { keep: true } },
      priceSources: [],
    };

    const merged = mergeMaterialMetadata(raw, {
      priceSources: [
        {
          id: "source-1",
          label: "Nhà cung cấp",
          url: "https://example.com/item",
          mode: "linked",
          fixedPrice: null,
          lastPrice: 125000,
          lastPriceText: "125.000 đ",
          currency: "VND",
          lastCheckedAt: "2026-11-04T00:00:00.000Z",
          note: "",
          isPrimary: true,
        },
      ],
      fieldLocks: { manufacturer: true },
    });

    expect(merged.materialProfile).toEqual(raw.materialProfile);
    expect(merged.futureWriter).toEqual(raw.futureWriter);
    expect(normalizeMaterialMetadata(merged).fieldLocks).toEqual({
      manufacturer: true,
    });
  });
});
