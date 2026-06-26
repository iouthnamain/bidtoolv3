import { describe, expect, it } from "bun:test";

import {
  deriveMatchStatus,
  deriveReviewRowStatus,
  deserializeRowDecision,
  seedDecisionFromItem,
  serializeRowDecision,
  type RowDecision,
} from "~/lib/materials/review-decision";

describe("review-decision", () => {
  it("round-trips serialize and deserialize", () => {
    const decision: RowDecision = {
      materialId: 42,
      acceptedFields: new Set(["code", "unit", "specText"] as const),
      overwriteFields: new Set(["specText"]),
      editedValues: { manufacturer: "Acme" },
      webProposedFields: { originCountry: "VN" },
      webEvidence: [
        {
          field: "originCountry",
          value: "VN",
          snippet: "Made in VN",
          sourceUrl: "https://x",
        },
      ],
      webSearchStatus: "done",
      skipped: false,
    };

    const serialized = serializeRowDecision(decision);
    const restored = deserializeRowDecision(serialized);
    expect(restored).not.toBeNull();
    expect(restored!.materialId).toBe(42);
    expect(restored!.acceptedFields.has("unit")).toBe(true);
    expect(restored!.overwriteFields?.has("specText")).toBe(true);
    expect(restored!.editedValues?.manufacturer).toBe("Acme");
    expect(restored!.webProposedFields?.originCountry).toBe("VN");
    expect(restored!.webEvidence?.[0]?.snippet).toBe("Made in VN");
    expect(restored!.webSearchStatus).toBe("done");
  });

  it("round-trips profile split web and AI fields", () => {
    const decision: RowDecision = {
      materialId: null,
      acceptedFields: new Set<"unit">(["unit"]),
      webLinkResults: [
        {
          title: "Product page",
          url: "https://example.com/p",
          domain: "example.com",
          snippet: "Specs here",
          query: "widget",
          rankScore: 0.9,
        },
      ],
      webLinksStatus: "done",
      aiSearchResult: {
        fields: { manufacturer: "Acme" },
        sourceUrls: ["https://example.com/p"],
        evidence: [
          {
            field: "manufacturer",
            value: "Acme",
            snippet: "By Acme",
            sourceUrl: "https://example.com/p",
          },
        ],
      },
      aiSearchStatus: "done",
      selectedSource: "ai",
      selectedSearchCandidateKey: "ai:0",
      aiSearchCandidates: [
        {
          fields: { manufacturer: "Acme" },
          sourceUrls: ["https://example.com/p"],
          evidence: [
            {
              field: "manufacturer",
              value: "Acme",
              snippet: "By Acme",
              sourceUrl: "https://example.com/p",
            },
          ],
          title: "Acme product",
          url: "https://example.com/p",
          rankScore: 0.88,
        },
        {
          fields: { manufacturer: "Beta" },
          sourceUrls: ["https://example.com/b"],
          evidence: [],
          url: "https://example.com/b",
          rankScore: 0.55,
        },
      ],
    };

    const restored = deserializeRowDecision(serializeRowDecision(decision));
    expect(restored?.webLinkResults?.[0]?.url).toBe("https://example.com/p");
    expect(restored?.webLinksStatus).toBe("done");
    expect(restored?.aiSearchResult?.fields.manufacturer).toBe("Acme");
    expect(restored?.aiSearchCandidates?.length).toBe(2);
    expect(restored?.aiSearchStatus).toBe("done");
    expect(restored?.selectedSource).toBe("ai");
    expect(restored?.selectedSearchCandidateKey).toBe("ai:0");
  });

  it("seeds auto row from item materialId and fill plan", () => {
    const decision = seedDecisionFromItem({
      id: 1,
      originalRowIndex: 3,
      materialId: 10,
      matchStatus: "matched",
      reviewDecisionJson: {},
      enrichedSnapshotJson: {
        status: "auto",
        fillPlan: [
          { field: "unit", action: "filled" },
          { field: "code", action: "filled" },
        ],
      },
    });
    expect(decision.materialId).toBe(10);
    expect(decision.acceptedFields.has("unit")).toBe(true);
    expect(decision.acceptedFields.has("code")).toBe(true);
  });

  it("prefers stored reviewDecisionJson when present", () => {
    const stored = serializeRowDecision({
      materialId: 99,
      acceptedFields: new Set(["unit"]),
      skipped: true,
    });
    const decision = seedDecisionFromItem({
      id: 2,
      originalRowIndex: 5,
      materialId: 10,
      matchStatus: "matched",
      reviewDecisionJson: stored,
      enrichedSnapshotJson: { status: "auto", fillPlan: [] },
    });
    expect(decision.materialId).toBe(99);
    expect(decision.skipped).toBe(true);
  });

  it("derives match status for assign, skip, and auto confirm", () => {
    expect(
      deriveMatchStatus(
        { materialId: null, acceptedFields: new Set(), skipped: true },
        "unmatched",
        null,
      ),
    ).toBe("unmatched");

    expect(
      deriveMatchStatus(
        { materialId: 7, acceptedFields: new Set(["unit"]) },
        "auto",
        7,
      ),
    ).toBe("matched");

    expect(
      deriveMatchStatus(
        { materialId: 8, acceptedFields: new Set(["unit"]) },
        "auto",
        7,
      ),
    ).toBe("manual");

    expect(
      deriveMatchStatus(
        { materialId: null, acceptedFields: new Set() },
        "review",
        null,
      ),
    ).toBe("candidates_found");

    expect(
      deriveMatchStatus(
        {
          materialId: null,
          acceptedFields: new Set(["specText"]),
          editedValues: { specText: "PVC D90" },
        },
        "unmatched",
        null,
      ),
    ).toBe("manual");
  });

  it("derives review row status when a web/AI or catalog candidate is chosen", () => {
    expect(
      deriveReviewRowStatus(
        {
          materialId: 7,
          acceptedFields: new Set(["unit"]),
        },
        "auto",
        7,
      ),
    ).toBe("auto");

    expect(
      deriveReviewRowStatus(
        {
          materialId: 8,
          acceptedFields: new Set(["unit"]),
        },
        "auto",
        7,
      ),
    ).toBe("review");

    expect(
      deriveReviewRowStatus(
        {
          materialId: null,
          acceptedFields: new Set(["specText", "defaultUnitPrice", "currency"]),
          editedValues: {
            specText: "PVC D90",
            defaultUnitPrice: "120000",
            currency: "VND",
          },
        },
        "unmatched",
        null,
      ),
    ).toBe("review");

    expect(
      deriveReviewRowStatus(undefined, "unmatched", null),
    ).toBe("unmatched");
  });

  it("seeds empty decisions for profile review until user chooses", () => {
    const decision = seedDecisionFromItem(
      {
        originalRowIndex: 1,
        materialId: 42,
        enrichedSnapshotJson: {
          status: "auto",
          fillPlan: [{ field: "unit", action: "filled" }],
        },
        reviewDecisionJson: null,
      },
      { emptyUntilReview: true },
    );
    expect(decision.materialId).toBeNull();
    expect(decision.acceptedFields.size).toBe(0);
  });
});
