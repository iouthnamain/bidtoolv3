export type AiRelevanceDecision = {
  url: string;
  verdict: "relevant" | "irrelevant" | "uncertain";
  confidence: number;
  productFamilyMatch: boolean;
  matchedIdentifiers: string[];
  conflictingIdentifiers: string[];
  numericSpecMatch: boolean | null;
  reasons: string[];
  evidence: Array<{
    sourceUrl: string;
    snippet: string;
  }>;
};
