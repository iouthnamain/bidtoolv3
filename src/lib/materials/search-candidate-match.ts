import type { AiSearchStoredResult, WebLinkResult } from "~/lib/materials/enrich-gap-fill";
import {
  FILLABLE_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";

export function normalizeMatchScore(score: number | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0;
  if (score > 1) return Math.min(1, score / 100);
  return Math.max(0, Math.min(1, score));
}

const OVERWRITE_CONFIDENCE = 0.85;

function tokenOverlap(a: string, b: string): number {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = right.split(/\s+/).filter(Boolean);
  if (rightTokens.length === 0) return 0;
  let hits = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) hits += 1;
  }
  return hits / rightTokens.length;
}

export function scoreAiCandidateCompletion(
  candidate: AiSearchStoredResult,
  sheetFields: Partial<Record<FillableField, string>>,
): number {
  const fields = candidate.fields;
  const confidences = candidate.fieldConfidences ?? {};
  const score = normalizeMatchScore(candidate.rankScore ?? 0) * 0.25;
  let filled = 0;
  let confidenceSum = 0;
  let conflictPenalty = 0;

  for (const field of FILLABLE_FIELDS) {
    if (field === "currency") continue;
    const value = fields[field]?.trim();
    if (!value) continue;
    const conf = confidences[field] ?? 0.5;
    const sheetVal = sheetFields[field]?.trim();
    if (sheetVal && sheetVal !== value) {
      if (conf >= OVERWRITE_CONFIDENCE) {
        filled += 0.5;
        confidenceSum += conf * 0.5;
      } else {
        conflictPenalty += 0.12;
      }
      continue;
    }
    filled += 1;
    confidenceSum += conf;
  }

  const fieldScore = filled * 0.07 + confidenceSum * 0.1;
  const pdfBonus = (candidate.catalogPdfUrls?.length ?? 0) > 0 ? 0.05 : 0;
  return Math.max(0, Math.min(1, score + fieldScore + pdfBonus - conflictPenalty));
}

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
  if (topScore > 0) {
    items[0]!.isRecommended = true;
  }
  return items;
}

export function webLinkMatchChips(
  link: WebLinkResult,
  rowName: string,
): { score: number; chips: string[] } {
  const score = normalizeMatchScore(link.rankScore);
  const chips: string[] = [];
  const pct = Math.round(score * 100);
  if (pct > 0) chips.push(`khớp web ${pct}%`);
  const titleOverlap = tokenOverlap(rowName, link.title);
  if (titleOverlap >= 0.35) {
    chips.push(`tên ${Math.round(titleOverlap * 100)}%`);
  }
  if (link.domain) chips.push(link.domain);
  return { score, chips };
}

export function aiCandidateMatchChips(
  candidate: AiSearchStoredResult,
  sheetFields: Partial<Record<FillableField, string>>,
  rowName: string,
): { score: number; chips: string[] } {
  const score = scoreAiCandidateCompletion(candidate, sheetFields);
  const fieldCount = Object.values(candidate.fields).filter(
    (value) => (value ?? "").trim().length > 0,
  ).length;
  const chips: string[] = [];
  if (fieldCount > 0) chips.push(`${fieldCount} trường AI`);

  const pdfCount = candidate.catalogPdfUrls?.length ?? 0;
  if (pdfCount > 0) chips.push(`${pdfCount} catalog PDF`);

  const nameOverlap = tokenOverlap(rowName, candidate.fields.code ?? "");
  const titleOverlap = tokenOverlap(rowName, candidate.title ?? "");
  const bestName = Math.max(nameOverlap, titleOverlap);
  if (bestName >= 0.35) {
    chips.push(`tên ${Math.round(bestName * 100)}%`);
  }

  if (
    sheetFields.manufacturer?.trim() &&
    candidate.fields.manufacturer?.trim() &&
    tokenOverlap(sheetFields.manufacturer, candidate.fields.manufacturer) >= 0.8
  ) {
    chips.push("NSX khớp");
  }

  const sheetUnit = sheetFields.unit?.trim().toLowerCase();
  const candidateUnit = candidate.fields.unit?.trim().toLowerCase();
  if (sheetUnit && candidateUnit && sheetUnit === candidateUnit) {
    chips.push("cùng ĐVT");
  }

  const pct = Math.round(score * 100);
  if (pct > 0) chips.push(`khớp ${pct}%`);

  return { score, chips };
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
