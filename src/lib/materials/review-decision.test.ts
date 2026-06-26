import { describe, expect, it } from "bun:test";

import {
  deriveMatchStatus,
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
  });
});
