import type { AiSearchStoredResult, WebLinkResult } from "~/lib/materials/enrich-gap-fill";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  assessAiCandidate,
  assessWebLinkCandidate,
  matchBand,
  normalizeMatchScore,
  scoreAiCandidateCompletion,
} from "~/lib/materials/match-assessment";

export { matchBand, normalizeMatchScore, scoreAiCandidateCompletion };

export function catalogCandidateScore(score: number | undefined): number {
  return normalizeMatchScore(score);
}

export function sortCandidatesByScore<T extends { score: number; status?: string }>(
  items: T[],
): T[] {
  const isDeferred = (item: T) =>
    item.status === "pending" || item.status === "error";
  const ready = items.filter((item) => !isDeferred(item));
  const deferred = items.filter((item) => isDeferred(item));
  ready.sort((left, right) => right.score - left.score);
  return [...ready, ...deferred];
}

export function markTopRecommended<T extends { score: number; isRecommended?: boolean }>(
  items: T[],
): T[] {
  if (items.length === 0) return items;
  for (const item of items) {
    item.isRecommended = false;
  }
  const topScore = items[0]!.score;
  if (matchBand(topScore) != null) {
    items[0]!.isRecommended = true;
  }
  return items;
}

export function webLinkMatchChips(
  link: WebLinkResult,
  rowName: string,
  sheetFields: Partial<Record<FillableField, string>> = {},
): { score: number; chips: string[] } {
  const assessment = assessWebLinkCandidate({ link, rowName, sheetFields });
  return { score: assessment.score, chips: assessment.reasons };
}

export function aiCandidateMatchChips(
  candidate: AiSearchStoredResult,
  sheetFields: Partial<Record<FillableField, string>>,
  rowName: string,
): { score: number; chips: string[] } {
  const assessment = assessAiCandidate({ candidate, sheetFields, rowName });
  return { score: assessment.score, chips: assessment.reasons };
}

export function searchCandidateKey(source: "web" | "ai", id: string) {
  return `${source}:${id}`;
}

export function parseSearchCandidateKey(key: string | undefined | null): {
  source: "web" | "ai";
  id: string;
} | null {
  if (!key) return null;
  const index = key.indexOf(":");
  if (index <= 0) return null;
  const source = key.slice(0, index);
  const id = key.slice(index + 1);
  if (source !== "web" && source !== "ai") return null;
  if (!id) return null;
  return { source, id };
}
