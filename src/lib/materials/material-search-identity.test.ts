import { describe, expect, it } from "vitest";

import {
  createMaterialSearchIdentity,
  normalizeMaterialSearchQueryVariant,
} from "./material-search-identity";

describe("material search identity", () => {
  it("normalizes Vietnamese dimensions, phi and square units", () => {
    expect(
      normalizeMaterialSearchQueryVariant(
        "Tủ điện 600 × 400 × 200mm; ống Ø 90; cáp 2,5 mm2",
      ),
    ).toContain("600x400x200");
    expect(normalizeMaterialSearchQueryVariant("Ống Φ90")).toContain("phi 90");
    expect(normalizeMaterialSearchQueryVariant("Cáp 2,5 mm2")).toContain(
      "2.5mm²",
    );
  });

  it("shares signatures across workspace rows but separates materials", () => {
    const first = createMaterialSearchIdentity({
      name: "Tủ điện treo tường 600x400x200mm",
      unit: "Cái",
      category: "Điện",
    });
    const equivalent = createMaterialSearchIdentity({
      name: "Tủ điện treo tường 600 × 400 × 200 mm",
      unit: "cái",
      category: "Thiết bị điện",
    });
    const other = createMaterialSearchIdentity({ name: "Tủ điện 800x600x250" });

    expect(first.signature).toBe(equivalent.signature);
    expect(first.signature).not.toBe(other.signature);
    expect(first.identifiers).toContain("600x400x200");
  });

  it("retains composite identifiers", () => {
    const identity = createMaterialSearchIdentity({
      name: "Aptomat 2P 32A 6kA SL4-M5 D90",
    });
    expect(identity.identifiers).toEqual(
      expect.arrayContaining(["2p", "32a", "6ka", "sl4-m5", "d90"]),
    );
  });
});
