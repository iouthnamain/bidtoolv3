import { describe, expect, it } from "vitest";

import { serializeRowDecision } from "~/lib/materials/review-decision";
import { materialProfileDecisionWithCurrentSearch } from "~/server/services/material-profile-review-decisions";

describe("material profile current search decision", () => {
  it("hydrates persisted user choices with the current web and selected AI result", () => {
    const item = {
      id: 12,
      materialId: null,
      reviewDecisionJson: serializeRowDecision({
        materialId: null,
        acceptedFields: new Set(["manufacturer"]),
        acceptedProfileFields: new Set(["name"]),
        selectedSource: "ai",
        selectedSearchCandidateKey: "ai:1",
        catalogPdfUrls: ["https://example.com/catalog.pdf"],
      }),
    } as unknown as Parameters<
      typeof materialProfileDecisionWithCurrentSearch
    >[0];
    const run = {
      webLinkResultsJson: [
        {
          title: "Trang sản phẩm",
          url: "https://example.com/pump",
          domain: "example.com",
          snippet: "Máy bơm",
          query: "máy bơm",
          rankScore: 0.91,
        },
      ],
      webLinksStatus: "done",
      aiSearchCandidatesJson: [
        {
          title: "Acme A",
          fields: { manufacturer: "Acme" },
          sourceUrls: ["https://example.com/a"],
          evidence: [],
        },
        {
          title: "Acme B",
          fields: { manufacturer: "Acme B" },
          sourceUrls: ["https://example.com/b"],
          evidence: [],
        },
      ],
      aiSearchStatus: "done",
    } as unknown as Parameters<
      typeof materialProfileDecisionWithCurrentSearch
    >[1];

    const decision = materialProfileDecisionWithCurrentSearch(item, run);

    expect(decision.webLinkResults?.[0]?.url).toBe("https://example.com/pump");
    expect(decision.aiSearchResult?.title).toBe("Acme B");
    expect(decision.acceptedProfileFields).toEqual(new Set(["name"]));
    expect(decision.catalogPdfUrls).toEqual([
      "https://example.com/catalog.pdf",
    ]);
  });
});
