import { describe, expect, it } from "vitest";

import {
  primaryLinkForItem,
  primaryLinkOpensExternally,
} from "./result-action-links";
import type { SearchItem } from "./search-types";

function searchItem(overrides: Partial<SearchItem>): SearchItem {
  return {
    entityType: "package",
    externalId: "IB230001",
    sourceUrl: "https://bidwinner.info/package/IB230001",
    title: "Gói thầu demo",
    province: "Hà Nội",
    inviter: "Bên mời thầu",
    category: "Hàng hóa",
    budget: 100_000_000,
    publishedAt: "2026-06-24",
    closingAt: "2026-06-30",
    matchScore: 90,
    ...overrides,
  } as SearchItem;
}

describe("search result primary links", () => {
  it("opens package results on BidWinner", () => {
    const item = searchItem({
      entityType: "package",
      externalId: "IB230001",
      sourceUrl: "https://bidwinner.info/package/IB230001",
    });

    expect(primaryLinkForItem(item)).toBe(
      "https://bidwinner.info/package/IB230001",
    );
    expect(primaryLinkOpensExternally(item)).toBe(true);
  });

  it("keeps plan and project results on in-app details", () => {
    const plan = searchItem({
      entityType: "plan",
      externalId: "PL230001",
      sourceUrl: "https://bidwinner.info/plan/PL230001",
    });
    const project = searchItem({
      entityType: "project",
      externalId: "PR230001",
      sourceUrl: "https://bidwinner.info/project/PR230001",
    });

    expect(primaryLinkForItem(plan)).toBe(
      "/plan-details/PL230001?sourceUrl=https%3A%2F%2Fbidwinner.info%2Fplan%2FPL230001",
    );
    expect(primaryLinkOpensExternally(plan)).toBe(false);
    expect(primaryLinkForItem(project)).toBe(
      "/project-details/PR230001?sourceUrl=https%3A%2F%2Fbidwinner.info%2Fproject%2FPR230001",
    );
    expect(primaryLinkOpensExternally(project)).toBe(false);
  });
});
