import { describe, expect, it } from "vitest";

import {
  buildHostSpecLabelPrefixes,
  resolveShopSiteProfile,
} from "~/lib/materials/shop-site-profiles";

describe("shop-site-profiles", () => {
  it("resolves known shop hosts", () => {
    expect(resolveShopSiteProfile("thegioiic.com").id).toBe("thegioiic");
    expect(resolveShopSiteProfile("www.codienhaiau.com").id).toBe("codienhaiau");
  });

  it("merges extra labels into spec prefixes", () => {
    const profile = resolveShopSiteProfile("thegioiic.com");
    const prefixes = buildHostSpecLabelPrefixes(profile, {
      manufacturer: ["ncc"],
      originCountry: ["xuất xứ"],
    });
    expect(prefixes).toEqual(
      expect.arrayContaining(["nsx", "hãng sx", "xx", "ncc", "xuất xứ"]),
    );
  });
});
