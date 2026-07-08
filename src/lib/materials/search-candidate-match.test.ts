import { describe, expect, it } from "vitest";

import type { AiSearchStoredResult } from "~/lib/materials/enrich-gap-fill";
import {
  aiCandidateMatchChips,
  markTopRecommended,
  RELIABLE_SEARCH_MATCH_THRESHOLD,
  scoreAiCandidateCompletion,
  sortCandidatesByScore,
} from "~/lib/materials/search-candidate-match";

describe("scoreAiCandidateCompletion", () => {
  it("scores higher when more fields fill empty sheet cells", () => {
    const sparse: AiSearchStoredResult = {
      fields: { manufacturer: "Bình Minh" },
      sourceUrls: [],
      evidence: [],
      fieldConfidences: { manufacturer: 0.9 },
    };
    const rich: AiSearchStoredResult = {
      fields: {
        manufacturer: "Bình Minh",
        code: "PVC-D90",
        unit: "m",
        defaultUnitPrice: "120000",
        sourceUrl: "https://example.vn/product",
      },
      sourceUrls: ["https://example.vn/product"],
      evidence: [],
      fieldConfidences: {
        manufacturer: 0.9,
        code: 0.85,
        unit: 0.8,
        defaultUnitPrice: 0.7,
        sourceUrl: 0.75,
      },
      catalogPdfUrls: ["https://example.vn/catalog.pdf"],
    };

    expect(
      scoreAiCandidateCompletion(rich, { manufacturer: "Khác" }),
    ).toBeGreaterThan(scoreAiCandidateCompletion(sparse, {}));
  });

  it("boosts candidates with detailed multi-line specText", () => {
    const shortSpec: AiSearchStoredResult = {
      fields: { specText: "PVC" },
      sourceUrls: [],
      evidence: [],
      fieldConfidences: { specText: 0.8 },
    };
    const detailedSpec: AiSearchStoredResult = {
      fields: {
        specText: [
          "Đường kính: 90 mm",
          "Chiều dài: 6 m",
          "Vật liệu: PVC",
          "Tiêu chuẩn: TCVN 8491",
          "Màu: Xám",
        ].join("\n"),
      },
      sourceUrls: [],
      evidence: [],
      fieldConfidences: { specText: 0.85 },
    };

    expect(scoreAiCandidateCompletion(detailedSpec, {})).toBeGreaterThan(
      scoreAiCandidateCompletion(shortSpec, {}),
    );
  });

  it("penalizes conflicts unless confidence is high enough to overwrite", () => {
    const lowConfidence: AiSearchStoredResult = {
      fields: { manufacturer: "Cadivi" },
      sourceUrls: [],
      evidence: [],
      fieldConfidences: { manufacturer: 0.4 },
    };
    const highConfidence: AiSearchStoredResult = {
      fields: { manufacturer: "Cadivi" },
      sourceUrls: [],
      evidence: [],
      fieldConfidences: { manufacturer: 0.9 },
    };

    expect(
      scoreAiCandidateCompletion(highConfidence, { manufacturer: "Bình Minh" }),
    ).toBeGreaterThan(
      scoreAiCandidateCompletion(lowConfidence, { manufacturer: "Bình Minh" }),
    );
  });

  it("scores AI candidates with matching code and spec as reliable", () => {
    const candidate: AiSearchStoredResult = {
      fields: {
        code: "CVV-2x2.5",
        unit: "m",
        specText: "Cáp CVV ruột đồng 2x2.5mm2, cách điện PVC",
        manufacturer: "CADIVI",
        sourceUrl: "https://cadivi.vn/cvv-2x2-5.pdf",
      },
      sourceUrls: ["https://cadivi.vn/cvv-2x2-5.pdf"],
      evidence: [],
      title: "Cáp CVV 2x2.5 CADIVI",
      url: "https://cadivi.vn/cvv-2x2-5.pdf",
      snippet: "Thông số kỹ thuật CVV 2x2.5mm2",
      rankScore: 1.8,
      fieldConfidences: {
        code: 0.95,
        unit: 0.95,
        specText: 0.95,
        manufacturer: 0.95,
        sourceUrl: 0.9,
      },
      catalogPdfUrls: ["https://cadivi.vn/cvv-2x2-5.pdf"],
    };

    const { score, chips } = aiCandidateMatchChips(
      candidate,
      {
        code: "CVV 2x2.5",
        unit: "m",
        specText: "Ruột đồng 2x2.5mm2 PVC",
        manufacturer: "CADIVI",
      },
      "Cáp điện hạ thế",
    );

    expect(score).toBeGreaterThanOrEqual(RELIABLE_SEARCH_MATCH_THRESHOLD);
    expect(chips).toContain("Mã SP");
  });

  it("keeps AI candidates with wrong provided code below reliable range", () => {
    const candidate: AiSearchStoredResult = {
      fields: {
        code: "CXV-4x6",
        unit: "m",
        specText: "Cáp CXV ruột đồng 4x6mm2",
        manufacturer: "CADIVI",
      },
      sourceUrls: ["https://cadivi.vn/cxv-4x6.pdf"],
      evidence: [],
      title: "Cáp CXV 4x6 CADIVI",
      url: "https://cadivi.vn/cxv-4x6.pdf",
      snippet: "Thông số kỹ thuật CXV 4x6mm2",
      rankScore: 2,
      fieldConfidences: {
        code: 0.95,
        unit: 0.95,
        specText: 0.95,
        manufacturer: 0.95,
      },
    };

    expect(
      scoreAiCandidateCompletion(
        candidate,
        {
          code: "CVV 2x2.5",
          unit: "m",
          specText: "Ruột đồng 2x2.5mm2 PVC",
          manufacturer: "CADIVI",
        },
        "Cáp điện hạ thế",
      ),
    ).toBeLessThan(RELIABLE_SEARCH_MATCH_THRESHOLD);
  });

  it("marks top recommended only at reliable threshold", () => {
    type Recommendable = { score: number; isRecommended?: boolean };
    const below = markTopRecommended<Recommendable>([
      { score: 0.74 },
      { score: 0.5 },
    ]);
    expect(below[0]?.isRecommended).toBe(false);

    const reliable = markTopRecommended<Recommendable>([
      { score: 0.75 },
      { score: 0.7 },
    ]);
    expect(reliable[0]?.isRecommended).toBe(true);
  });
});

describe("sortCandidatesByScore", () => {
  it("sorts ready candidates by score desc and keeps pending last", () => {
    const sorted = sortCandidatesByScore([
      { score: 0.2, status: "pending" },
      { score: 0.9 },
      { score: 0.5 },
      { score: 0.1, status: "error" },
    ]);

    expect(sorted.map((item) => item.score)).toEqual([0.9, 0.5, 0.2, 0.1]);
  });
});
