import { describe, expect, it } from "vitest";

import { evaluateAutoProfileCandidate } from "~/lib/materials/profile-auto-gate";
import { buildMaterialProfileCanonicalBackfillPatch } from "~/server/services/material-profile-workspaces";

const row = {
  name: "Ống nhựa PVC D90 Bình Minh",
  unit: "m",
  specText: "Ống PVC D90, độ dày 3 mm",
  manufacturer: "Bình Minh",
  originCountry: "Việt Nam",
};

const sourceUrl = "https://binhminh.com.vn/san-pham/ong-pvc-d90";
const catalogUrl = "https://binhminh.com.vn/catalog/ong-pvc-d90.pdf";

function evidencedCandidate(overrides = {}) {
  return {
    fields: {
      code: "BM-PVC-D90",
      unit: "m",
      specText: "Ống nhựa PVC D90, độ dày 3 mm",
      manufacturer: "Bình Minh",
      originCountry: "Việt Nam",
      defaultUnitPrice: "50000",
    },
    sourceUrls: [sourceUrl],
    evidence: [
      {
        field: "code",
        value: "BM-PVC-D90",
        sourceUrl,
        snippet: "Mã BM-PVC-D90",
      },
      { field: "unit", value: "m", sourceUrl, snippet: "Đơn vị: m" },
      {
        field: "specText",
        value: "Ống nhựa PVC D90, độ dày 3 mm",
        sourceUrl,
        snippet: "Ống PVC D90 dày 3 mm",
      },
      {
        field: "manufacturer",
        value: "Bình Minh",
        sourceUrl,
        snippet: "Nhà sản xuất Bình Minh",
      },
      {
        field: "originCountry",
        value: "Việt Nam",
        sourceUrl,
        snippet: "Xuất xứ Việt Nam",
      },
      { field: "price", value: "50000", sourceUrl, snippet: "Giá 50.000" },
    ],
    catalogPdfUrls: [catalogUrl],
    catalogEvidenceUrls: [catalogUrl],
    fieldConfidences: {
      code: 0.95,
      unit: 0.95,
      specText: 0.95,
      manufacturer: 0.95,
      originCountry: 0.95,
      defaultUnitPrice: 0.95,
    },
    title: "Ống nhựa PVC D90 Bình Minh",
    url: sourceUrl,
    rankScore: 100,
    ...overrides,
  };
}

describe("automatic material-profile evidence gate", () => {
  it("accepts only a fully evidenced, identity-matching catalog candidate", () => {
    const result = evaluateAutoProfileCandidate({
      row,
      candidate: evidencedCandidate(),
    });

    expect(result).toMatchObject({
      allowed: true,
      sourceUrl,
      catalogUrl,
    });
  });

  it("rejects a rich but conflicting technical specification", () => {
    const candidate = evidencedCandidate({
      fields: {
        ...evidencedCandidate().fields,
        specText: "Ống nhựa PVC D110, độ dày 5 mm",
      },
      evidence: evidencedCandidate().evidence.map((evidence) =>
        evidence.field === "specText"
          ? {
              ...evidence,
              value: "Ống nhựa PVC D110, độ dày 5 mm",
              snippet: "Ống PVC D110 dày 5 mm",
            }
          : evidence,
      ),
    });

    const result = evaluateAutoProfileCandidate({ row, candidate });

    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Thông số");
  });

  it("rejects unsupported field facts and a model-only catalog URL", () => {
    const candidate = evidencedCandidate({
      evidence: evidencedCandidate().evidence.filter(
        (evidence) => evidence.field !== "manufacturer",
      ),
      catalogEvidenceUrls: [],
    });

    const result = evaluateAutoProfileCandidate({ row, candidate });

    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Nhà sản xuất");
    expect(result.reasons.join(" ")).toContain("catalog PDF");
  });
});

describe("canonical local-match backfill", () => {
  it("persists derived identity fields without overwriting populated catalog facts", () => {
    const patch = buildMaterialProfileCanonicalBackfillPatch({
      material: {
        code: null,
        name: "Ống nhựa PVC D90 Bình Minh",
        unit: "m",
        category: null,
        specText: "",
        manufacturer: "Bình Minh cũ",
        originCountry: "Việt Nam",
        defaultUnitPrice: 49000,
        currency: "VND",
        sourceUrl,
        metadataJson: { existing: true },
      },
      resolution: {
        candidate: {
          code: "BT-PVC-D90",
          name: row.name,
          unit: row.unit,
          specText: row.specText,
          manufacturer: "Bình Minh mới",
          originCountry: "Việt Nam",
          unitPrice: 50000,
          source: "binhminh.com.vn",
          sourceUrl,
          catalogUrl,
          confidence: 0.9,
          provenance: "catalog",
          codeProvenance: "generated",
        },
      },
      category: "Ống nhựa",
      resolvedAt: "2026-07-10T00:00:00.000Z",
    });

    expect(patch).toMatchObject({
      code: "BT-PVC-D90",
      category: "Ống nhựa",
      specText: row.specText,
      manufacturer: "Bình Minh cũ",
      defaultUnitPrice: 49000,
      sourceUrl,
    });
    expect(patch.metadataJson).toMatchObject({
      existing: true,
      materialProfile: {
        catalogUrl,
        codeProvenance: "generated",
      },
    });
  });
});
