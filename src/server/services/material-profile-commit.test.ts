import { describe, expect, it } from "vitest";

import {
  materialNameUnitDedupKey,
  materialNameUnitKeysMatch,
  nameUnitDedupKeyForTest,
  resolveProfileCommitFieldsForTest,
} from "~/server/services/material-profile-commit";

describe("material-profile-commit helpers", () => {
  it("builds name+unit dedup keys case-insensitively", () => {
    expect(nameUnitDedupKeyForTest("  Cáp CV  ", " Mét ")).toBe("cáp cv|mét");
    expect(materialNameUnitDedupKey("CÁP CV", "MÉT")).toBe(
      materialNameUnitDedupKey("cáp cv", "mét"),
    );
    expect(
      materialNameUnitKeysMatch("Cáp CV", "Mét", "cáp cv", "mét"),
    ).toBe(true);
    expect(
      materialNameUnitKeysMatch("Cáp CV", "Mét", "Cáp CV", "cái"),
    ).toBe(false);
  });

  it("resolves accepted decision fields over sheet originals", () => {
    const item = {
      id: 1,
      workspaceId: 1,
      materialId: null,
      originalRowIndex: 2,
      originalDataJson: {
        code: "OLD",
        unit: "cái",
        manufacturer: "Sheet NSX",
      },
      productName: "Cáp điện",
      specText: "2x2.5",
      unit: "cái",
      currency: "VND",
      vendorHint: "Sheet NSX",
      originHint: null,
      unitPrice: 1000,
      sortOrder: 0,
      includedInExport: true,
      enrichmentStatus: "idle",
      webResultsJson: [],
      aiFieldsJson: {},
      aiEvidenceJson: [],
      enrichmentUpdatedAt: null,
      enrichedSnapshotJson: {},
      reviewDecisionJson: {},
      matchStatus: "unmatched" as const,
      committedAt: null,
      commitSource: null,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    };

    const fields = resolveProfileCommitFieldsForTest(
      item as unknown as Parameters<typeof resolveProfileCommitFieldsForTest>[0],
      {
        materialId: null,
        acceptedFields: [
          "code",
          "manufacturer",
          "unit",
          "specText",
          "defaultUnitPrice",
        ],
        editedValues: {
          code: "CV-225",
          manufacturer: "CADIVI",
          unit: "mét",
          specText: "CV 2x2.5",
          defaultUnitPrice: "1250000",
        },
        catalogPdfUrls: ["https://example.vn/a.pdf"],
      },
    );

    expect(fields).toMatchObject({
      name: "Cáp điện",
      code: "CV-225",
      manufacturer: "CADIVI",
      unit: "mét",
      specText: "CV 2x2.5",
      defaultUnitPrice: 1250000,
      catalogPdfUrls: ["https://example.vn/a.pdf"],
    });
  });
});
