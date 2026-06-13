import { describe, expect, it } from "vitest";

import {
  chooseScrapedProductName,
  extractProductNameFromCardText,
  isShopPromoBadgeText,
  parseDepreciationFromSpecText,
  resolveProductNameFromCandidates,
  sanitizeScrapedProductList,
  sanitizeScrapedProductName,
  stripKhauHaoFromSpecText,
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

  it("skips warranty-only lines and strips warranty prefixes", () => {
    expect(sanitizeScrapedProductName("BH 6 tháng")).toBeNull();
    expect(
      extractProductNameFromCardText(
        "BH 6 tháng\nVinasemi 948DB+ II Máy Hàn Trạm Điều Chỉnh Nhiệt Độ\n807.120 đ/ Máy",
      ),
    ).toBe("Vinasemi 948DB+ II Máy Hàn Trạm Điều Chỉnh Nhiệt Độ");
    expect(
      sanitizeScrapedProductName(
        "BH 12 tháng Vinasemi 948DB+ II Máy Hàn Trạm Điều Chỉnh Nhiệt Độ",
      ),
    ).toBe("Vinasemi 948DB+ II Máy Hàn Trạm Điều Chỉnh Nhiệt Độ");
  });

  it("rejects stock-count and account action text as product names", () => {
    expect(sanitizeScrapedProductName("Còn 10 cái")).toBeNull();
    expect(sanitizeScrapedProductName("Đăng ký")).toBeNull();
    expect(
      extractProductNameFromCardText(
        "Còn 10 cái\nMạch điều khiển động cơ bước TB6600\n990,000 ₫",
      ),
    ).toBe("Mạch điều khiển động cơ bước TB6600");
    expect(
      sanitizeScrapedProductName("Còn 10 cái Module cảm biến độ ẩm HR202"),
    ).toBe("Module cảm biến độ ẩm HR202");
    expect(
      sanitizeScrapedProductName(
        "Module cảm biến độ ẩm HR202 Đà Nẵng Hàng còn 12 cái",
      ),
    ).toBe("Module cảm biến độ ẩm HR202 Đà Nẵng");
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

  it("prefers title source over longer polluted anchor text", () => {
    expect(
      resolveProductNameFromCandidates([
        { value: "IC - Mạch Tích Hợp", source: "anchor_text" },
        {
          value: "Mạch Giảm Áp DC-DC Mini560 5A",
          source: "title",
        },
      ]),
    ).toBe("Mạch Giảm Áp DC-DC Mini560 5A");
  });

  it("strips KH and Khấu hao noise from spec text", () => {
    expect(
      stripKhauHaoFromSpecText(
        "Đồng hồ đo KH 0.05 Thông số kỹ thuật điện áp 220V",
      ),
    ).toBe("Đồng hồ đo Thông số kỹ thuật điện áp 220V");
    expect(parseDepreciationFromSpecText("Khấu hao: 5%")).toBe(0.05);
  });

  it("chooses higher-quality product names when merging", () => {
    expect(
      chooseScrapedProductName(
        "IC - Mạch Tích Hợp",
        "Mạch Giảm Áp DC-DC Mini560 5A",
        "anchor_text",
        "title",
      ),
    ).toBe("Mạch Giảm Áp DC-DC Mini560 5A");
  });
});
