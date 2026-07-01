import { describe, expect, it } from "vitest";

import {
  domainMatches,
  normalizeDomainList,
  normalizeEngineList,
} from "./search-domain-policy";

describe("search-domain-policy", () => {
  it("normalizes comma and newline domain lists", () => {
    expect(
      normalizeDomainList(
        "https://www.BinhMinhPlastic.com.vn/catalog\nshopee.vn/item, tiki.vn",
      ),
    ).toEqual(["binhminhplastic.com.vn", "shopee.vn", "tiki.vn"]);
  });

  it("matches subdomains against configured hostnames", () => {
    expect(
      domainMatches("catalog.binhminhplastic.com.vn", "binhminhplastic.com.vn"),
    ).toBe(true);
    expect(domainMatches("example.com", "binhminhplastic.com.vn")).toBe(false);
  });

  it("normalizes engine ids and dedupes", () => {
    expect(normalizeEngineList("Google, bing, duckduckgo, GOOGLE")).toEqual([
      "google",
      "bing",
      "duckduckgo",
    ]);
  });
});
