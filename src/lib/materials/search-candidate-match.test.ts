import { describe, expect, it } from "vitest";

import type { AiSearchStoredResult } from "~/lib/materials/enrich-gap-fill";
import {
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
