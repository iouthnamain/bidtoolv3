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
