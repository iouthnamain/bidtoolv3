import "server-only";

import { z } from "zod";

import type { WebLinkResult } from "~/lib/materials/enrich-gap-fill";
import type { AiRelevanceDecision } from "~/lib/materials/material-search-ai-types";
import type { MaterialSearchIdentity } from "~/lib/materials/material-search-identity";
import { normalizeMaterialSearchText } from "~/lib/materials/material-search-identity";
import { callAiProvider } from "~/server/services/ai-dispatch";
import {
  resolveAiProvider,
  resolveEnrichmentAiTimeoutMs,
} from "~/server/services/app-settings";

const decisionSchema = z.object({
  url: z.string().url(),
  verdict: z.enum(["relevant", "irrelevant", "uncertain"]),
  confidence: z.number().min(0).max(1),
  productFamilyMatch: z.boolean(),
  matchedIdentifiers: z.array(z.string()).max(20),
  conflictingIdentifiers: z.array(z.string()).max(20),
  numericSpecMatch: z.boolean().nullable(),
  reasons: z.array(z.string()).max(12),
  evidence: z
    .array(
      z.object({
        sourceUrl: z.string().url(),
        snippet: z.string().min(1).max(800),
      }),
    )
    .max(12),
});

const outputSchema = z.object({ decisions: z.array(decisionSchema).max(5) });

function extractJson(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI không trả JSON hợp lệ.");
  return content.slice(start, end + 1);
}

export function canAiPromoteDecision(
  decision: AiRelevanceDecision,
  candidate: WebLinkResult,
  identity?: MaterialSearchIdentity,
) {
  const hardRejects = candidate.assessment?.hardRejects ?? [];
  if (
    hardRejects.some(
      (reject) => reject === "unsafe" || reject === "operator_rejected",
    )
  )
    return false;
  const candidateEvidenceText = normalizeMaterialSearchText(
    `${candidate.title} ${candidate.snippet}`,
  );
  const validatedEvidence = decision.evidence.filter(
    (evidence) =>
      evidence.sourceUrl === candidate.url &&
      candidateEvidenceText.includes(
        normalizeMaterialSearchText(evidence.snippet),
      ),
  );
  const evidenceText = normalizeMaterialSearchText(
    validatedEvidence.map((evidence) => evidence.snippet).join(" "),
  );
  const evidenceIdentifiers =
    identity?.identifiers.filter((identifier) =>
      evidenceText.includes(identifier),
    ) ?? [];
  if (
    hardRejects.some(
      (reject) =>
        reject === "identifier_conflict" || reject === "identity_missing",
    ) &&
    evidenceIdentifiers.length === 0
  )
    return false;
  if (
    hardRejects.includes("dimension_conflict") &&
    !identity?.compositeDimensions.some((dimension) =>
      evidenceText.includes(dimension),
    )
  )
    return false;
  if (
    hardRejects.includes("product_family_conflict") &&
    identity?.productPhrase &&
    !evidenceText.includes(identity.productPhrase)
  )
    return false;
  return (
    candidate.fetchStatus === "verified" &&
    decision.verdict === "relevant" &&
    decision.confidence >= 0.95 &&
    decision.productFamilyMatch &&
    decision.conflictingIdentifiers.length === 0 &&
    decision.numericSpecMatch !== false &&
    (!identity ||
      decision.matchedIdentifiers.every((identifier) =>
        identity.identifiers.includes(normalizeMaterialSearchText(identifier)),
      )) &&
    (!hardRejects.some(
      (reject) =>
        reject === "identifier_conflict" || reject === "dimension_conflict",
    ) ||
      decision.matchedIdentifiers.length > 0) &&
    validatedEvidence.some((evidence) => evidence.snippet.trim().length > 0)
  );
}

export async function rerankAmbiguousMaterialLinks(input: {
  identity: MaterialSearchIdentity;
  candidates: WebLinkResult[];
  signal?: AbortSignal;
}) {
  const candidates = input.candidates
    .filter((candidate) => {
      const assessment = candidate.assessment;
      return (
        assessment != null &&
        ((assessment.score >= 0.2 && assessment.score < 0.75) ||
          assessment.aiOverrideEligible)
      );
    })
    .slice(0, 5);
  if (candidates.length === 0) return { decisions: [], promotedResults: [] };

  const provider = await resolveAiProvider("enrichment");
  const timeout = AbortSignal.timeout(await resolveEnrichmentAiTimeoutMs());
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout])
    : timeout;
  const completion = await callAiProvider(
    provider,
    [
      {
        role: "system",
        content:
          "Bạn đánh giá độ liên quan sản phẩm. Chỉ dùng bằng chứng được cung cấp. Trả JSON {decisions:[...]}; không giải thích ngoài JSON và không trả chain-of-thought.",
      },
      {
        role: "user",
        content: JSON.stringify({
          material: input.identity,
          candidates: candidates.map((candidate) => ({
            url: candidate.url,
            title: candidate.title,
            snippet: candidate.snippet,
            deterministic: candidate.assessment,
          })),
          schema: {
            url: "string",
            verdict: "relevant|irrelevant|uncertain",
            confidence: "0..1",
            productFamilyMatch: "boolean",
            matchedIdentifiers: ["string"],
            conflictingIdentifiers: ["string"],
            numericSpecMatch: "boolean|null",
            reasons: ["string"],
            evidence: [
              { sourceUrl: "candidate URL", snippet: "verbatim excerpt" },
            ],
          },
        }),
      },
    ],
    { signal, responseFormat: "json_object" },
  );
  const parsed = outputSchema.parse(
    JSON.parse(extractJson(completion.content)),
  );
  const decisions = parsed.decisions.filter((decision) =>
    candidates.some((candidate) => candidate.url === decision.url),
  );
  const promotedResults: WebLinkResult[] = candidates
    .map((candidate) => {
      const decision = decisions.find((item) => item.url === candidate.url);
      if (
        !decision ||
        !canAiPromoteDecision(decision, candidate, input.identity)
      )
        return null;
      return {
        ...candidate,
        assessment: candidate.assessment
          ? {
              ...candidate.assessment,
              score: Math.max(candidate.assessment.score, decision.confidence),
              tier: "primary" as const,
              hardRejects: [],
              reasons: [...candidate.assessment.reasons, ...decision.reasons],
            }
          : undefined,
        aiDecision: decision,
      };
    })
    .filter((candidate) => candidate != null) as WebLinkResult[];
  return { decisions, promotedResults };
}
