import { describe, expect, it } from "vitest";

import type { AiRelevanceDecision } from "~/lib/materials/material-search-ai-types";
import type { WebLinkResult } from "~/lib/materials/enrich-gap-fill";
import { createMaterialSearchIdentity } from "~/lib/materials/material-search-identity";
import { canAiPromoteDecision } from "./material-search-ai-reranker";

const decision: AiRelevanceDecision = {
  url: "https://example.vn/product",
  verdict: "relevant",
  confidence: 0.95,
  productFamilyMatch: true,
  matchedIdentifiers: ["sl4-m5"],
  conflictingIdentifiers: [],
  numericSpecMatch: true,
  reasons: ["Khớp sản phẩm"],
  evidence: [
    {
      sourceUrl: "https://example.vn/product",
      snippet: "Model SL4-M5 chính hãng",
    },
  ],
};
const identity = createMaterialSearchIdentity({ name: "Sản phẩm SL4-M5" });

function candidate(overrides: Partial<WebLinkResult> = {}): WebLinkResult {
  return {
    title: "Sản phẩm SL4-M5",
    url: decision.url,
    domain: "example.vn",
    snippet: "Model SL4-M5 chính hãng",
    fetchStatus: "verified",
    assessment: {
      score: 0.5,
      tier: "weak",
      dimensions: {
        identity: 0.5,
        specification: 0.5,
        sourceTrust: 0.8,
        retrievalConsensus: 0.5,
      },
      reasons: [],
      conflicts: [],
      hardRejects: [],
      aiOverrideEligible: false,
    },
    ...overrides,
  };
}

describe("AI relevance promotion", () => {
  it("requires 95% confidence, fetched evidence and compatible identity", () => {
    expect(canAiPromoteDecision(decision, candidate(), identity)).toBe(true);
    expect(
      canAiPromoteDecision(
        { ...decision, confidence: 0.94 },
        candidate(),
        identity,
      ),
    ).toBe(false);
    expect(
      canAiPromoteDecision(
        decision,
        candidate({ fetchStatus: "unverified" }),
        identity,
      ),
    ).toBe(false);
    expect(
      canAiPromoteDecision(
        { ...decision, evidence: [] },
        candidate(),
        identity,
      ),
    ).toBe(false);
    expect(
      canAiPromoteDecision(
        {
          ...decision,
          evidence: [{ sourceUrl: decision.url, snippet: "Đoạn bịa đặt" }],
        },
        candidate(),
        identity,
      ),
    ).toBe(false);
    expect(
      canAiPromoteDecision(
        { ...decision, matchedIdentifiers: ["wrong-999"] },
        candidate(),
        identity,
      ),
    ).toBe(false);
  });

  it("cannot override safety or operator feedback", () => {
    for (const reject of ["unsafe", "operator_rejected"] as const) {
      expect(
        canAiPromoteDecision(
          decision,
          candidate({
            assessment: {
              ...candidate().assessment!,
              tier: "rejected",
              hardRejects: [reject],
              aiOverrideEligible: false,
            },
          }),
          identity,
        ),
      ).toBe(false);
    }
  });

  it("requires evidence that specifically resolves deterministic conflicts", () => {
    const conflicted = candidate({
      assessment: {
        ...candidate().assessment!,
        tier: "rejected",
        hardRejects: ["identifier_conflict"],
        aiOverrideEligible: true,
      },
    });
    expect(
      canAiPromoteDecision(
        {
          ...decision,
          matchedIdentifiers: [],
          evidence: [
            { sourceUrl: decision.url, snippet: "Sản phẩm chính hãng" },
          ],
        },
        conflicted,
        identity,
      ),
    ).toBe(false);
  });
});
