import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  FILLABLE_FIELDS,
  type FillableField,
  type MatchScoreBreakdown,
} from "~/lib/materials/excel-enrich-fields";
import {
  createMaterialSearchIdentity,
  normalizeMaterialSearchText,
  type MaterialSearchIdentity,
  type MaterialSearchIdentityInput,
} from "~/lib/materials/material-search-identity";

export type MatchBand = "high" | "medium";

export type MatchDimensions = {
  identity: number;
  spec: number;
  sourceTrust: number;
  fieldCoverage: number;
  conflictRisk: number;
};

export type MatchAssessment = {
  score: number;
  band: MatchBand | null;
  label: "Cao 85%+" | "Đạt 75%+" | null;
  dimensions: MatchDimensions;
  reasons: string[];
  warnings: string[];
};

export type MaterialSearchHardReject =
  | "unsafe"
  | "operator_rejected"
  | "identifier_conflict"
  | "dimension_conflict"
  | "product_family_conflict"
  | "identity_missing";

export type MaterialSearchAssessment = {
  score: number;
  tier: "primary" | "weak" | "rejected";
  dimensions: {
    identity: number;
    specification: number;
    sourceTrust: number;
    retrievalConsensus: number;
  };
  reasons: string[];
  conflicts: string[];
  hardRejects: MaterialSearchHardReject[];
  aiOverrideEligible: boolean;
};

export const MATCH_THRESHOLDS = {
  high: 0.85,
  reliable: 0.75,
  medium: 0.75,
} as const;

export const RELIABLE_SEARCH_MATCH_THRESHOLD = MATCH_THRESHOLDS.reliable;

const EMPTY_DIMENSIONS: MatchDimensions = {
  identity: 0,
  spec: 0,
  sourceTrust: 0,
  fieldCoverage: 0,
  conflictRisk: 0,
};

export function clampMatchScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

export function normalizeMatchScore(score: number | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0;
  if (score > 1) return Math.min(1, score / 100);
  return clampMatchScore(score);
}

export function matchBand(score: number): MatchBand | null {
  if (score >= MATCH_THRESHOLDS.high) return "high";
  if (score >= MATCH_THRESHOLDS.medium) return "medium";
  return null;
}

export function matchBandLabel(
  band: MatchBand | null,
): "Cao 85%+" | "Đạt 75%+" | null {
  if (band === "high") return "Cao 85%+";
  if (band === "medium") return "Đạt 75%+";
  return null;
}

export function matchScorePercent(score: number): number {
  return Math.round(clampMatchScore(score) * 100);
}

export function createMatchAssessment(input: {
  score: number;
  dimensions?: Partial<MatchDimensions>;
  reasons?: string[];
  warnings?: string[];
}): MatchAssessment {
  const score = clampMatchScore(input.score);
  const band = matchBand(score);
  return {
    score,
    band,
    label: matchBandLabel(band),
    dimensions: {
      ...EMPTY_DIMENSIONS,
      ...(input.dimensions ?? {}),
    },
    reasons: compactReasons(input.reasons ?? []),
    warnings: input.warnings ?? [],
  };
}

function compactReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const reason of reasons) {
    const trimmed = reason.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= 4) break;
  }
  return result;
}

function stripAccents(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function normalizeText(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  const normalizedText = normalizeMaterialSearchText(text);
  const normalizedPhrase = normalizeMaterialSearchText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function compactCode(value: string | undefined): string {
  return normalizeText(value ?? "").replace(/\s+/g, "");
}

export function tokenOverlap(
  a: string | undefined,
  b: string | undefined,
): number {
  const left = normalizeText(a ?? "");
  const right = normalizeText(b ?? "");
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) {
    return (
      Math.min(left.length, right.length) / Math.max(left.length, right.length)
    );
  }
  const leftTokens = new Set(
    left.split(/\s+/).filter((token) => token.length > 1),
  );
  const rightTokens = right.split(/\s+/).filter((token) => token.length > 1);
  if (rightTokens.length === 0) return 0;
  let hits = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) hits += 1;
  }
  return hits / rightTokens.length;
}

function normalizeSearchRank(score: number | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0;
  if (score > 10) return clampMatchScore(score / 100);
  return clampMatchScore(score / 2);
}

function domainFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceTrustFromUrl(
  url: string | undefined,
  domain = domainFromUrl(url),
): number {
  if (!url && !domain) return 0;
  const value = `${url ?? ""} ${domain}`.toLowerCase();
  let score = 0.55;
  if (/\.pdf(?:$|[?#])/i.test(url ?? "")) score += 0.25;
  if (domain.endsWith(".vn")) score += 0.1;
  if (/(manufacturer|catalog|datasheet|spec|product)/i.test(value))
    score += 0.1;
  if (/(shopee|lazada|tiki|facebook|youtube|tiktok)/i.test(value))
    score -= 0.25;
  return clampMatchScore(score);
}

const PRODUCT_FAMILIES = [
  ["tu dien", ["tu lanh", "tu quan ao", "wardrobe", "refrigerator"]],
  ["ong", ["google play", "apple store", "ung dung"]],
  ["cap dien", ["cap quang", "day deo", "cable tie"]],
] as const;

function familyConflict(identityText: string, resultText: string) {
  for (const [family, conflicts] of PRODUCT_FAMILIES) {
    if (!identityText.includes(family)) continue;
    const conflict = conflicts.find((term) => resultText.includes(term));
    if (conflict) return conflict;
  }
  return null;
}

function normalizedRrfConsensus(rrfScore: number | undefined) {
  if (!rrfScore || !Number.isFinite(rrfScore)) return 0;
  // Three rank-1 occurrences are already near full retrieval consensus.
  return clampMatchScore(rrfScore / (3 / 61));
}

function identifierEvidence(identity: MaterialSearchIdentity, text: string) {
  const matches = identity.identifiers.filter((value) => text.includes(value));
  const resultIdentifiers = new Set(
    text.match(/\b(?=[a-z0-9./-]*\d)[a-z0-9]+(?:[./-][a-z0-9]+)*\b/g) ?? [],
  );
  const conflicts = identity.identifiers.filter((expected) => {
    if (matches.includes(expected)) return false;
    const alpha = expected.replace(/\d+/g, "");
    return [...resultIdentifiers].some(
      (candidate) => alpha && candidate.replace(/\d+/g, "") === alpha,
    );
  });
  return { matches, conflicts };
}

export function assessMaterialSearchCandidate(input: {
  identity: MaterialSearchIdentity | MaterialSearchIdentityInput;
  candidate: Pick<
    WebLinkResult,
    "title" | "url" | "domain" | "snippet" | "rrfScore"
  >;
  unsafe?: boolean;
  operatorRejected?: boolean;
}): MaterialSearchAssessment {
  const identity =
    "signature" in input.identity
      ? input.identity
      : createMaterialSearchIdentity(input.identity);
  const text = normalizeMaterialSearchText(
    `${input.candidate.title} ${input.candidate.snippet} ${input.candidate.url}`,
  );
  const nameForward = tokenOverlap(identity.normalizedName, text);
  const nameBackward = tokenOverlap(text, identity.normalizedName);
  const fullNameMatch = Number(text.includes(identity.normalizedName));
  const phraseMatch = identity.productPhrase
    ? Number(text.includes(identity.productPhrase))
    : 0;
  const searchPhrase = identity.searchPhrase
    ? normalizeMaterialSearchText(identity.searchPhrase)
    : "";
  const searchPhraseMatch = searchPhrase
    ? Number(containsNormalizedPhrase(text, searchPhrase))
    : 0;
  const manufacturerMatch = identity.manufacturer
    ? tokenOverlap(identity.manufacturer, text)
    : 0.5;
  const identifiers = identifierEvidence(identity, text);
  const dimensionsMatched = identity.compositeDimensions.filter((dimension) =>
    text.includes(dimension),
  );
  const identityBaseScore =
    Math.max(fullNameMatch, Math.min(nameForward, nameBackward)) * 0.35 +
    phraseMatch * 0.3 +
    manufacturerMatch * 0.1 +
    (identity.identifiers.length
      ? identifiers.matches.length / identity.identifiers.length
      : 0.5) *
      0.25;
  // Long model/spec strings can make a provider miss an otherwise relevant
  // product-family page. A strong broad-phrase match is enough for a weak
  // result, but never overrides identifier, dimension, family, or safety
  // conflicts below.
  const broadIdentityScore =
    searchPhraseMatch >= 0.75
      ? searchPhraseMatch * 0.45 + manufacturerMatch * 0.1
      : 0;
  const identityScore = clampMatchScore(
    Math.max(identityBaseScore, broadIdentityScore),
  );
  const matchedSpecs = identity.highSignalSpecTokens.filter((token) =>
    text.includes(token),
  );
  const specification = identity.highSignalSpecTokens.length
    ? clampMatchScore(
        matchedSpecs.length / identity.highSignalSpecTokens.length +
          (dimensionsMatched.length > 0 ? 0.25 : 0),
      )
    : Math.max(0.25, specQuality(input.candidate.snippet) * 0.5);
  const sourceTrust = sourceTrustFromUrl(
    input.candidate.url,
    input.candidate.domain,
  );
  const retrievalConsensus = normalizedRrfConsensus(input.candidate.rrfScore);
  const hardRejects: MaterialSearchHardReject[] = [];
  const conflicts: string[] = [];
  if (input.unsafe) hardRejects.push("unsafe");
  if (input.operatorRejected) hardRejects.push("operator_rejected");
  if (identifiers.conflicts.length > 0) {
    hardRejects.push("identifier_conflict");
    conflicts.push(`Khác mã: ${identifiers.conflicts.join(", ")}`);
  }
  if (
    identity.compositeDimensions.length > 0 &&
    dimensionsMatched.length === 0 &&
    /\b\d+(?:x\d+){1,3}\b/.test(text)
  ) {
    hardRejects.push("dimension_conflict");
    conflicts.push("Kích thước không tương thích");
  }
  const family = familyConflict(identity.normalizedName, text);
  if (family) {
    hardRejects.push("product_family_conflict");
    conflicts.push(`Sai nhóm sản phẩm: ${family}`);
  }
  if (identityScore < 0.18 && searchPhraseMatch < 0.75) {
    hardRejects.push("identity_missing");
  }

  let score = clampMatchScore(
    identityScore * 0.55 +
      specification * 0.25 +
      sourceTrust * 0.1 +
      retrievalConsensus * 0.1,
  );
  if (hardRejects.length > 0) score = Math.min(score, 0.749);
  const nonOverridable = hardRejects.some((reject) =>
    ["unsafe", "operator_rejected"].includes(reject),
  );
  const tier =
    score < 0.2 || hardRejects.length > 0
      ? "rejected"
      : score >= 0.75
        ? "primary"
        : "weak";
  const reasons = compactReasons([
    phraseMatch || searchPhraseMatch >= 0.75 ? "Khớp cụm sản phẩm" : "",
    identifiers.matches.length
      ? `Khớp mã: ${identifiers.matches.join(", ")}`
      : "",
    manufacturerMatch >= 0.7 ? "Khớp nhà sản xuất" : "",
    matchedSpecs.length
      ? `Khớp thông số: ${matchedSpecs.slice(0, 3).join(", ")}`
      : "",
  ]);

  return {
    score,
    tier,
    dimensions: {
      identity: identityScore,
      specification,
      sourceTrust,
      retrievalConsensus,
    },
    reasons,
    conflicts,
    hardRejects: [...new Set(hardRejects)],
    aiOverrideEligible:
      !nonOverridable &&
      hardRejects.some((reject) =>
        [
          "identifier_conflict",
          "dimension_conflict",
          "product_family_conflict",
          "identity_missing",
        ].includes(reject),
      ),
  };
}

function specQuality(specText: string | undefined): number {
  const spec = specText?.trim() ?? "";
  if (!spec) return 0;
  const lineCount = spec.split("\n").filter((line) => line.trim()).length;
  if (lineCount >= 5 || spec.length >= 120) return 1;
  if (lineCount >= 2 || spec.length >= 40) return 0.65;
  return 0.35;
}

function sameNormalizedValue(
  a: string | undefined,
  b: string | undefined,
): boolean {
  const left = normalizeText(a ?? "");
  const right = normalizeText(b ?? "");
  return left.length > 0 && left === right;
}

function containsNormalizedValue(
  haystack: string | undefined,
  needle: string | undefined,
) {
  const normalizedHaystack = normalizeText(haystack ?? "");
  const normalizedNeedle = normalizeText(needle ?? "");
  return (
    normalizedHaystack.length > 0 &&
    normalizedNeedle.length > 0 &&
    normalizedHaystack.includes(normalizedNeedle)
  );
}

function codeEvidence(
  code: string | undefined,
  text: string | undefined,
): { score: number; conflict: boolean } {
  const normalizedCode = normalizeText(code ?? "");
  const normalizedText = normalizeText(text ?? "");
  if (!normalizedCode || !normalizedText) return { score: 0, conflict: false };

  const codeCompact = compactCode(normalizedCode);
  const textCompact = compactCode(normalizedText);
  if (codeCompact && textCompact.includes(codeCompact)) {
    return { score: 1, conflict: false };
  }

  const codeTokens = normalizedCode
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  if (codeTokens.length === 0) return { score: 0, conflict: false };
  const hits = codeTokens.filter((token) =>
    new RegExp(`(^|\\s)${token}(\\s|$)`).test(normalizedText),
  ).length;
  const score = hits / codeTokens.length;
  return { score, conflict: score === 0 };
}

function weightedFieldCoverage(
  fields: Partial<Record<FillableField, string>>,
  confidences: Partial<Record<FillableField, number>>,
): {
  score: number;
  filledCount: number;
} {
  const weights: Partial<Record<FillableField, number>> = {
    code: 1,
    unit: 0.8,
    category: 0.6,
    specText: 1.2,
    manufacturer: 1,
    originCountry: 0.8,
    defaultUnitPrice: 0.7,
    sourceUrl: 0.5,
  };

  let total = 0;
  let filled = 0;
  let filledCount = 0;
  for (const field of FILLABLE_FIELDS) {
    if (field === "currency") continue;
    const weight = weights[field] ?? 0;
    if (weight <= 0) continue;
    total += weight;
    const value = fields[field]?.trim() ?? "";
    if (!value) continue;
    filled += weight * (confidences[field] ?? 0.5);
    filledCount += 1;
  }

  return {
    score: total > 0 ? clampMatchScore(filled / total) : 0,
    filledCount,
  };
}

function conflictRisk(
  fields: Partial<Record<FillableField, string>>,
  sheetFields: Partial<Record<FillableField, string>>,
  confidences: Partial<Record<FillableField, number>>,
): number {
  let risk = 0;
  for (const field of FILLABLE_FIELDS) {
    if (field === "currency") continue;
    const value = fields[field]?.trim();
    const sheetValue = sheetFields[field]?.trim();
    if (!value || !sheetValue || sameNormalizedValue(value, sheetValue))
      continue;
    if (
      field === "specText" &&
      (containsNormalizedValue(value, sheetValue) ||
        Math.max(
          tokenOverlap(sheetValue, value),
          tokenOverlap(value, sheetValue),
        ) >= 0.6)
    ) {
      continue;
    }
    risk += (confidences[field] ?? 0.5) >= 0.85 ? 0.07 : 0.18;
  }
  return clampMatchScore(risk);
}

export function assessCatalogCandidate(input: {
  score: number | undefined;
  breakdown?: MatchScoreBreakdown | null;
  fillCount?: number;
}): MatchAssessment {
  const score = normalizeMatchScore(input.score);
  const breakdown = input.breakdown;
  const reasons: string[] = [];
  if ((breakdown?.nameSimilarity ?? 0) >= 0.5) reasons.push("Tên");
  if ((breakdown?.codeMatch ?? 0) >= 0.9) reasons.push("Mã SP");
  if ((breakdown?.manufacturerMatch ?? 0) >= 0.9) reasons.push("NSX");
  if ((breakdown?.unitMatch ?? 0) >= 1) reasons.push("ĐVT");
  if ((breakdown?.specMatch ?? 0) >= 0.7) reasons.push("Thông số");
  if ((breakdown?.dimensionMatch ?? 0) > 0.5) reasons.push("Kích thước");
  if ((input.fillCount ?? 0) > 0) reasons.push(`${input.fillCount} trường`);

  return createMatchAssessment({
    score,
    dimensions: {
      identity: breakdown
        ? clampMatchScore(
            breakdown.nameSimilarity * 0.5 +
              (breakdown.codeMatch ?? 0) * 0.3 +
              breakdown.manufacturerMatch * 0.2 +
              breakdown.unitMatch * 0.15 +
              breakdown.originMatch * 0.1,
          )
        : score,
      spec: breakdown
        ? clampMatchScore(
            breakdown.specMatch * 0.7 + breakdown.dimensionMatch * 0.3,
          )
        : 0,
      sourceTrust: 0.8,
      fieldCoverage: clampMatchScore((input.fillCount ?? 0) / 6),
      conflictRisk: 0,
    },
    reasons,
  });
}

export function assessWebLinkCandidate(input: {
  link: WebLinkResult;
  rowName: string;
  sheetFields?: Partial<Record<FillableField, string>>;
}): MatchAssessment {
  const { link, rowName, sheetFields = {} } = input;
  const text = `${link.title} ${link.snippet} ${link.url} ${link.query ?? ""}`;
  const nameOverlap = tokenOverlap(rowName, link.title);
  const queryOverlap = tokenOverlap(rowName, link.query);
  const manufacturerOverlap = tokenOverlap(sheetFields.manufacturer, text);
  const code = codeEvidence(sheetFields.code, text);
  const specOverlap = Math.max(
    tokenOverlap(sheetFields.specText, text),
    specQuality(link.snippet) * 0.35,
  );
  const sourceTrust = sourceTrustFromUrl(link.url, link.domain);
  const searchRank = normalizeSearchRank(link.rankScore);
  const identity = clampMatchScore(
    code.score * 0.35 +
      nameOverlap * 0.35 +
      queryOverlap * 0.15 +
      manufacturerOverlap * 0.1 +
      searchRank * 0.05,
  );
  let score = clampMatchScore(
    identity * 0.45 +
      specOverlap * 0.15 +
      sourceTrust * 0.25 +
      searchRank * 0.15,
  );
  if (code.conflict && (sheetFields.code?.trim() ?? "")) {
    score = Math.min(score, 0.69);
  }

  const reasons: string[] = [];
  if (code.score >= 0.8) reasons.push("Mã SP");
  if (nameOverlap >= 0.35) reasons.push("Tên");
  if (manufacturerOverlap >= 0.45) reasons.push("NSX");
  if (specOverlap >= 0.65) reasons.push("Thông số");
  if (/\.pdf(?:$|[?#])/i.test(link.url)) reasons.push("PDF");
  if (link.domain) reasons.push(link.domain);

  return createMatchAssessment({
    score,
    dimensions: {
      identity,
      spec: specOverlap,
      sourceTrust,
      fieldCoverage: 0.2,
      conflictRisk: 0,
    },
    reasons,
  });
}

export function assessAiCandidate(input: {
  candidate: AiSearchStoredResult;
  sheetFields: Partial<Record<FillableField, string>>;
  rowName: string;
}): MatchAssessment {
  const { candidate, sheetFields, rowName } = input;
  const fields = candidate.fields;
  const confidences = candidate.fieldConfidences ?? {};
  const candidateText = [
    fields.code,
    candidate.title,
    candidate.snippet,
    candidate.url,
    ...(candidate.sourceUrls ?? []),
    ...(candidate.catalogPdfUrls ?? []),
  ].join(" ");
  const code = codeEvidence(sheetFields.code, candidateText);
  const bestName = Math.max(
    tokenOverlap(rowName, candidate.title),
    tokenOverlap(rowName, fields.code),
    tokenOverlap(rowName, fields.specText),
  );
  const manufacturerMatch = tokenOverlap(
    sheetFields.manufacturer,
    fields.manufacturer,
  );
  const unitMatch =
    sheetFields.unit?.trim() && fields.unit?.trim()
      ? sameNormalizedValue(sheetFields.unit, fields.unit)
        ? 1
        : 0
      : 0.5;
  const originMatch =
    sheetFields.originCountry?.trim() && fields.originCountry?.trim()
      ? sameNormalizedValue(sheetFields.originCountry, fields.originCountry)
        ? 1
        : tokenOverlap(sheetFields.originCountry, fields.originCountry)
      : 0.5;
  const searchRank = normalizeSearchRank(candidate.rankScore);
  const identity = clampMatchScore(
    code.score * 0.35 +
      bestName * 0.25 +
      manufacturerMatch * 0.2 +
      unitMatch * 0.15 +
      originMatch * 0.1 +
      searchRank * 0.1,
  );
  const spec = Math.max(
    specQuality(fields.specText),
    tokenOverlap(sheetFields.specText, fields.specText),
    tokenOverlap(sheetFields.specText, candidateText),
  );
  const sourceTrust = Math.max(
    ...[
      ...(candidate.sourceUrls ?? []),
      candidate.url,
      ...(candidate.catalogPdfUrls ?? []),
    ].map((url) => sourceTrustFromUrl(url)),
    0,
  );
  const coverage = weightedFieldCoverage(fields, confidences);
  let risk = conflictRisk(fields, sheetFields, confidences);
  if (code.conflict && (sheetFields.code?.trim() ?? "")) {
    risk = Math.max(risk, 0.35);
  }
  const evidenceFreshness =
    (candidate.sourceUrls?.length ?? 0) > 0 || candidate.url ? 0.6 : 0.25;
  let score = clampMatchScore(
    identity * 0.4 +
      spec * 0.25 +
      sourceTrust * 0.15 +
      coverage.score * 0.15 +
      evidenceFreshness * 0.05 -
      risk,
  );
  if (code.conflict && (sheetFields.code?.trim() ?? "")) {
    score = Math.min(score, 0.69);
  }

  const reasons: string[] = [];
  if (coverage.filledCount > 0) reasons.push(`${coverage.filledCount} trường`);
  if ((candidate.catalogPdfUrls?.length ?? 0) > 0) {
    reasons.push(`${candidate.catalogPdfUrls?.length ?? 0} PDF`);
  }
  if (manufacturerMatch >= 0.8) reasons.push("NSX");
  if (code.score >= 0.8) reasons.push("Mã SP");
  if (unitMatch >= 1) reasons.push("ĐVT");
  if (spec >= 0.65) reasons.push("Thông số");

  return createMatchAssessment({
    score,
    dimensions: {
      identity,
      spec,
      sourceTrust,
      fieldCoverage: coverage.score,
      conflictRisk: risk,
    },
    reasons,
    warnings: risk > 0 ? ["Có dữ liệu khác sheet"] : [],
  });
}

export function scoreAiCandidateCompletion(
  candidate: AiSearchStoredResult,
  sheetFields: Partial<Record<FillableField, string>>,
  rowName = "",
): number {
  return assessAiCandidate({ candidate, sheetFields, rowName }).score;
}
