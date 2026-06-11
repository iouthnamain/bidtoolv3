import { describe, expect, it } from "vitest";

import {
  extractProductNameFromCardText,
  isShopPromoBadgeText,
  resolveProductNameFromCandidates,
  sanitizeScrapedProductList,
  sanitizeScrapedProductName,
  stripShopPromoBadgePrefix,
} from "./shop-promo-badges";

describe("shop promo badge helpers", () => {
  it("detects common Vietnamese promo sticker labels", () => {
    expect(isShopPromoBadgeText("Thịnh thành")).toBe(true);
    expect(isShopPromoBadgeText("Thịnh hành")).toBe(true);
    expect(isShopPromoBadgeText("Bán chạy")).toBe(true);
    expect(isShopPromoBadgeText("Flash sale")).toBe(true);
    expect(isShopPromoBadgeText("Đồng hồ đo tần số Selec MF16")).toBe(false);
  });

  it("strips glued and spaced promo prefixes", () => {
    expect(
      stripShopPromoBadgePrefix(
        "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm",
      ),
    ).toBe("Đồng hồ đo đa năng Selec VAF36A 96x96mm");
    expect(stripShopPromoBadgePrefix("Bán chạyHot Máy khoan")).toBe(
      "Máy khoan",
    );
  });

  it("extracts product names when promo badge is on its own line", () => {
    expect(
      sanitizeScrapedProductName(
        "Thịnh thành\nĐồng hồ đo đa năng Selec VAF36A 96x96mm",
      ),
    ).toBe("Đồng hồ đo đa năng Selec VAF36A 96x96mm");
    expect(
      extractProductNameFromCardText(
        "Thịnh thành\nĐồng hồ đo đa năng Selec VAF36A 96x96mm\n700.000 ₫",
      ),
    ).toBe("Đồng hồ đo đa năng Selec VAF36A 96x96mm");
    expect(
      resolveProductNameFromCandidates(
        ["Thịnh thành"],
        "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm 700.000 ₫",
      ),
    ).toBe("Đồng hồ đo đa năng Selec VAF36A 96x96mm");
  });

  it("rejects promo-only names and listing-page duplicates", () => {
    expect(sanitizeScrapedProductName("Thịnh thành")).toBeNull();
    expect(
      sanitizeScrapedProductList([
        {
          name: "Thịnh thành",
          sourceUrl:
            "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
        },
        {
          name: "Thịnh thành Đồng hồ đo đa năng Selec VAF36A 96x96mm",
          sourceUrl:
            "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
        },
        {
          name: "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
          sourceUrl:
            "https://codienhaiau.com/category/dong-ho-do/dong-ho-do-tan-so/",
        },
      ]),
    ).toEqual([
      {
        name: "Đồng hồ đo đa năng Selec VAF36A 96x96mm",
        sourceUrl:
          "https://codienhaiau.com/product/dong-ho-do-da-nang-selec-vaf36a/",
      },
    ]);
  });
});
