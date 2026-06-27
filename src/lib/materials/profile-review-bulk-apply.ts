import type { ReviewRow } from "~/app/_components/materials/review/review-types";
import {
  applyAllProposedFieldsWithCurrency,
} from "~/lib/materials/enrich-gap-fill";
import {
  candidateToFields,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { RowDecision } from "~/lib/materials/review-decision";
import {
  aiCandidateMatchChips,
  catalogCandidateScore,
  searchCandidateKey,
} from "~/lib/materials/search-candidate-match";

export const PROFILE_AUTO_APPLY_THRESHOLD = 0.85;

function acceptedFieldsFromFillPlan(row: ReviewRow): Set<FillableField> {
  return new Set<FillableField>(
    row.fillPlan
      .filter((cell) => cell.action === "filled")
      .map((cell) => cell.field),
  );
}

export function catalogDecisionForRow(
  row: ReviewRow,
  threshold = PROFILE_AUTO_APPLY_THRESHOLD,
): RowDecision | null {
  const candidate = row.topCandidate;
  if (!candidate || catalogCandidateScore(candidate.score) < threshold) {
    return null;
  }

  const candidateFields = candidateToFields(candidate);
  const { acceptedFields, editedValues } =
    applyAllProposedFieldsWithCurrency(candidateFields);
  const fromFillPlan = acceptedFieldsFromFillPlan(row);

  return {
    materialId: candidate.materialId,
    selectedSource: "catalog",
    acceptedFields: fromFillPlan.size > 0 ? fromFillPlan : acceptedFields,
    overwriteFields: new Set(),
    editedValues,
  };
}

function profileSearchFields(decision: RowDecision) {
  return {
    webLinkResults: decision.webLinkResults,
    webLinksStatus: decision.webLinksStatus,
    aiSearchResult: decision.aiSearchResult,
    aiSearchCandidates: decision.aiSearchCandidates,
    aiSearchStatus: decision.aiSearchStatus,
    catalogPdfUrls: decision.catalogPdfUrls,
  };
}

export function searchResultDecisionForRow(
  row: ReviewRow,
  decision: RowDecision,
  threshold = PROFILE_AUTO_APPLY_THRESHOLD,
): RowDecision | null {
  const profileFields = profileSearchFields(decision);
  const aiCandidates = decision.aiSearchCandidates?.length
    ? decision.aiSearchCandidates
    : decision.aiSearchResult
      ? [decision.aiSearchResult]
      : [];

  if (aiCandidates.length > 0) {
    let bestIndex = -1;
    let bestScore = 0;
    aiCandidates.forEach((candidate, index) => {
      const fieldCount = Object.values(candidate.fields).filter(
        (value) => (value ?? "").trim().length > 0,
      ).length;
      if (fieldCount === 0) return;
      const { score } = aiCandidateMatchChips(
        candidate,
        row.sheetFields,
        row.name,
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      const aiResult = aiCandidates[bestIndex]!;
      const gapFields = applyAllProposedFieldsWithCurrency(aiResult.fields);
      return {
        materialId: null,
        selectedSource: "ai",
        selectedSearchCandidateKey: searchCandidateKey("ai", String(bestIndex)),
        acceptedFields: gapFields.acceptedFields,
        overwriteFields: new Set(),
        editedValues: gapFields.editedValues,
        webProposedFields: { ...aiResult.fields },
        webEvidence: aiResult.evidence,
        ...profileFields,
        catalogPdfUrls: aiResult.catalogPdfUrls,
        aiSearchResult: aiResult,
      };
    }
  }

  return catalogDecisionForRow(row, threshold);
}

export function rowHasSearchResults(decision: RowDecision | undefined): boolean {
  if (!decision) return false;
  return (
    (decision.webLinkResults?.length ?? 0) > 0 ||
    (decision.aiSearchCandidates?.length ?? 0) > 0 ||
    decision.aiSearchResult != null
  );
}

export function countCatalogEligibleRows(
  rows: ReviewRow[],
  rowIndices: Iterable<number>,
  threshold = PROFILE_AUTO_APPLY_THRESHOLD,
): number {
  let count = 0;
  for (const rowIndex of rowIndices) {
    const row = rows.find((item) => item.originalRowIndex === rowIndex);
    if (row && catalogDecisionForRow(row, threshold)) count += 1;
  }
  return count;
}

export function countSearchResultEligibleRows(
  rows: ReviewRow[],
  decisions: Map<number, RowDecision>,
  rowIndices: Iterable<number>,
  threshold = PROFILE_AUTO_APPLY_THRESHOLD,
): number {
  let count = 0;
  for (const rowIndex of rowIndices) {
    const row = rows.find((item) => item.originalRowIndex === rowIndex);
    const decision = decisions.get(rowIndex);
    if (!row || !decision || !rowHasSearchResults(decision)) continue;
    if (searchResultDecisionForRow(row, decision, threshold)) count += 1;
  }
  return count;
}
