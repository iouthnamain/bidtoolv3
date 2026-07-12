import { describe, expect, it } from "vitest";

import { assessMaterialSearchCandidate } from "~/lib/materials/match-assessment";
import { createMaterialSearchIdentity } from "~/lib/materials/material-search-identity";
import { vnMaterialSearchCases } from "./fixtures/vn-material-search-cases";

describe("Vietnamese guarded material benchmark", () => {
  it("meets the balanced offline release gate", () => {
    let primaryShown = 0;
    let relevantPrimary = 0;
    let relevantTotal = 0;
    let relevantRetrieved = 0;
    let falseRecommendations = 0;
    let unsafeVisible = 0;

    for (const fixture of vnMaterialSearchCases) {
      const identity = createMaterialSearchIdentity(fixture.row);
      const ranked = fixture.candidates
        .map((candidate) => {
          const assessment = assessMaterialSearchCandidate({
            identity,
            candidate: {
              ...candidate,
              rrfScore: candidate.queryRanks.reduce(
                (sum, rank) => sum + 1 / (60 + rank),
                0,
              ),
            },
            unsafe: candidate.label === "unsafe",
          });
          return { ...candidate, assessment };
        })
        .sort((left, right) => right.assessment.score - left.assessment.score);
      const primary = ranked
        .filter((candidate) => candidate.assessment.tier === "primary")
        .slice(0, 3);
      const visible = ranked
        .filter((candidate) => candidate.assessment.tier !== "rejected")
        .slice(0, 8);
      primaryShown += primary.length;
      relevantPrimary += primary.filter(
        (candidate) => candidate.label === "relevant",
      ).length;
      relevantTotal += ranked.filter(
        (candidate) => candidate.label === "relevant",
      ).length;
      relevantRetrieved += visible.filter(
        (candidate) => candidate.label === "relevant",
      ).length;
      if (primary[0] && primary[0].label !== "relevant") {
        falseRecommendations += 1;
      }
      unsafeVisible += visible.filter(
        (candidate) => candidate.label === "unsafe",
      ).length;
    }

    const precisionAt3 = primaryShown ? relevantPrimary / primaryShown : 1;
    const recallAt8 = relevantTotal ? relevantRetrieved / relevantTotal : 1;
    const falseRecommendationRate =
      falseRecommendations / vnMaterialSearchCases.length;

    console.info("guarded-material-benchmark", {
      cases: vnMaterialSearchCases.length,
      precisionAt3,
      recallAt8,
      falseRecommendationRate,
      unsafeVisible,
    });
    expect(vnMaterialSearchCases).toHaveLength(55);
    expect(precisionAt3).toBeGreaterThanOrEqual(0.9);
    expect(recallAt8).toBeGreaterThanOrEqual(0.85);
    expect(falseRecommendationRate).toBeLessThan(0.02);
    expect(unsafeVisible).toBe(0);
  });
});
