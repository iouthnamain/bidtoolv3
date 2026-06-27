import { describe, expect, it } from "vitest";

import {
  catalogDecisionForRow,
  countCatalogEligibleRows,
  countSearchResultEligibleRows,
  PROFILE_AUTO_APPLY_THRESHOLD,
  searchResultDecisionForRow,
} from "~/lib/materials/profile-review-bulk-apply";
import type { ReviewRow } from "~/app/_components/materials/review/review-types";
import type { RowDecision } from "~/lib/materials/review-decision";

function reviewRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    key: 1,
    originalRowIndex: 2,
    name: "Ống thép mạ kẽm",
    status: "auto",
    sheetFields: { unit: "m", specText: "DN50" },
    candidates: [],
    topCandidate: {
      materialId: 10,
      name: "Ống thép mạ kẽm DN50",
      code: "VT-001",
      unit: "m",
      category: null,
      manufacturer: null,
      originCountry: null,
      defaultUnitPrice: null,
      currency: "VND",
      imageUrl: null,
      sourceUrl: null,
      specSnippet: "DN50",
      score: 0.9,
      breakdown: null,
    },
    fillPlan: [
      {
        field: "specText",
        action: "filled",
        before: "",
        after: "DN50",
      },
    ],
    ...overrides,
  };
}

describe("profile review bulk apply", () => {
  it("builds catalog decisions at or above the auto-apply threshold", () => {
    const decision = catalogDecisionForRow(reviewRow());
    expect(decision?.materialId).toBe(10);
    expect(decision?.acceptedFields.has("specText")).toBe(true);
    expect(
      catalogDecisionForRow(
        reviewRow({
          topCandidate: {
            ...reviewRow().topCandidate!,
            score: PROFILE_AUTO_APPLY_THRESHOLD - 0.01,
          },
        }),
      ),
    ).toBeNull();
  });

  it("prefers the best AI candidate when applying search results", () => {
    const row = reviewRow({ status: "unmatched", topCandidate: null });
    const decision: RowDecision = {
      materialId: null,
      acceptedFields: new Set(),
      aiSearchCandidates: [
        {
          fields: { manufacturer: "Hòa Phát", specText: "DN50" },
          sourceUrls: ["https://example.com/a"],
          evidence: [],
          fieldConfidences: { manufacturer: 0.9, specText: 0.9 },
        },
        {
          fields: { manufacturer: "Other", specText: "DN40" },
          sourceUrls: ["https://example.com/b"],
          evidence: [],
          fieldConfidences: { manufacturer: 0.5, specText: 0.5 },
        },
      ],
      aiSearchStatus: "done",
    };

    const applied = searchResultDecisionForRow(row, decision);
    expect(applied?.selectedSource).toBe("ai");
    expect(applied?.selectedSearchCandidateKey).toBe("ai:0");
    expect(applied?.acceptedFields.has("manufacturer")).toBe(true);
  });

  it("counts eligible rows for bulk actions", () => {
    const rows = [
      reviewRow(),
      reviewRow({
        key: 2,
        originalRowIndex: 3,
        topCandidate: { ...reviewRow().topCandidate!, score: 0.5 },
      }),
    ];
    const decisions = new Map<number, RowDecision>([
      [
        2,
        {
          materialId: null,
          acceptedFields: new Set(),
          aiSearchCandidates: [
            {
              fields: { code: "ABC" },
              sourceUrls: [],
              evidence: [],
              fieldConfidences: { code: 0.95 },
            },
          ],
          aiSearchStatus: "done",
        },
      ],
    ]);

    expect(countCatalogEligibleRows(rows, [2, 3])).toBe(1);
    expect(countSearchResultEligibleRows(rows, decisions, [2])).toBe(1);
    expect(countSearchResultEligibleRows(rows, decisions, [2, 3])).toBe(1);
  });
});
