import { describe, expect, it } from "vitest";

import { assessMaterialSearchCandidate } from "./match-assessment";
import { createMaterialSearchIdentity } from "./material-search-identity";

const identity = createMaterialSearchIdentity({
  name: "Tủ điện treo tường 600x400x200mm",
  specText: "Thép sơn tĩnh điện",
  unit: "Cái",
});

describe("guarded material assessment", () => {
  it.each([
    ["Tủ lạnh cửa thép 600 lít", "product_family_conflict"],
    ["Tủ quần áo thép sơn tĩnh điện", "product_family_conflict"],
  ])("rejects unrelated product families: %s", (title, hardReject) => {
    const assessment = assessMaterialSearchCandidate({
      identity,
      candidate: {
        title,
        url: "https://example.vn/item",
        domain: "example.vn",
        snippet: "Giá tốt, giao hàng toàn quốc",
      },
    });
    expect(assessment.tier).toBe("rejected");
    expect(assessment.hardRejects).toContain(hardReject);
  });

  it("makes exact identity and compatible specs primary", () => {
    const assessment = assessMaterialSearchCandidate({
      identity,
      candidate: {
        title: "Tủ điện treo tường 600x400x200",
        url: "https://manufacturer.vn/product/600x400x200",
        domain: "manufacturer.vn",
        snippet:
          "Tủ điện treo tường 600x400x200 bằng thép sơn tĩnh điện, catalog sản phẩm",
        rrfScore: 3 / 61,
      },
    });
    expect(assessment.tier).toBe("primary");
    expect(assessment.score).toBeGreaterThanOrEqual(0.75);
  });

  it("keeps a strong broad product-family source visible as weak", () => {
    const broadIdentity = createMaterialSearchIdentity({
      name: "Van tiết lưu 1 chiều M5 Φ4 (SL4-M5)",
      manufacturer: "OEM",
      specText: "M5, phi 4, 30x19",
    });
    const assessment = assessMaterialSearchCandidate({
      identity: broadIdentity,
      candidate: {
        title: "Van tiết lưu là gì? Nguyên lý, phân loại và ứng dụng",
        url: "https://example.vn/van-tiet-luu",
        domain: "example.vn",
        snippet: "Tìm hiểu van tiết lưu và các loại van tiết lưu.",
      },
    });

    expect(broadIdentity.searchPhrase).toBe("Van tiết lưu");
    expect(assessment.tier).toBe("weak");
    expect(assessment.hardRejects).not.toContain("identity_missing");
  });

  it("keeps valve-family evidence and rejects vans or vehicle pages", () => {
    const valveIdentity = createMaterialSearchIdentity({
      name: "Van 1 chiều M5 Φ4 SL4-M5",
    });

    expect(valveIdentity.searchPhrase).toBe("Van 1 chiều");

    const relevant = assessMaterialSearchCandidate({
      identity: valveIdentity,
      candidate: {
        title: "Van 1 chiều M5 phi 4 SL4-M5",
        url: "https://example.vn/van-1-chieu",
        domain: "example.vn",
        snippet: "Van một chiều dùng cho đường khí nén.",
      },
    });
    expect(relevant.tier).not.toBe("rejected");

    for (const title of [
      "Vans Việt Nam - giày thời trang chính hãng",
      "Giá xe tải van mới nhất",
    ]) {
      const unrelated = assessMaterialSearchCandidate({
        identity: valveIdentity,
        candidate: {
          title,
          url: "https://example.vn/item",
          domain: "example.vn",
          snippet: "Thông tin sản phẩm và bảng giá.",
        },
      });
      expect(unrelated.tier).toBe("rejected");
      expect(unrelated.hardRejects).toContain("identity_missing");
    }
  });

  it("never makes safety and operator rejects AI-overridable", () => {
    for (const key of ["unsafe", "operatorRejected"] as const) {
      const assessment = assessMaterialSearchCandidate({
        identity,
        candidate: {
          title: identity.name,
          url: "https://example.vn/item",
          domain: "example.vn",
          snippet: identity.name,
        },
        [key]: true,
      });
      expect(assessment.tier).toBe("rejected");
      expect(assessment.aiOverrideEligible).toBe(false);
    }
  });
});
