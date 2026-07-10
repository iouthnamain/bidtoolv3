import type { AiSearchStoredResult } from "~/lib/materials/enrich-gap-fill";
import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  assessAiCandidate,
  tokenOverlap,
} from "~/lib/materials/match-assessment";

export type AutoProfileRowIdentity = {
  name: string;
  code?: string | null;
  unit: string;
  specText: string;
  manufacturer?: string | null;
  category?: string | null;
  originCountry?: string | null;
};

export type AutoProfileCandidateEvaluation = {
  allowed: boolean;
  reasons: string[];
  score: number;
  confidence: number;
  sourceUrl: string | null;
  catalogUrl: string | null;
  evidenceUrls: string[];
};

const AUTO_FIELD_CONFIDENCE = 0.85;

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedUrl(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isPdfUrl(value: string | null | undefined) {
  const normalized = normalizedUrl(value);
  if (!normalized) return false;
  try {
    return /\.pdf$/i.test(new URL(normalized).pathname);
  } catch {
    return false;
  }
}

function bidirectionalOverlap(left: string, right: string) {
  return Math.min(tokenOverlap(left, right), tokenOverlap(right, left));
}

function numericTokens(value: string) {
  return new Set(value.match(/\d+(?:[.,]\d+)?/g) ?? []);
}

function hasCompatibleNumbers(left: string, right: string) {
  const leftNumbers = numericTokens(left);
  if (leftNumbers.size === 0) return true;
  const rightNumbers = numericTokens(right);
  for (const number of leftNumbers) {
    if (rightNumbers.has(number)) return true;
  }
  return false;
}

function sameEvidenceValue(
  field: FillableField,
  expected: string,
  actual: string,
) {
  if (field === "defaultUnitPrice") {
    const expectedDigits = expected.replace(/\D/g, "");
    const actualDigits = actual.replace(/\D/g, "");
    return Boolean(
      expectedDigits && actualDigits && expectedDigits === actualDigits,
    );
  }
  const expectedNormalized = normalizeText(expected);
  const actualNormalized = normalizeText(actual);
  return (
    Boolean(expectedNormalized) &&
    Boolean(actualNormalized) &&
    (expectedNormalized === actualNormalized ||
      expectedNormalized.includes(actualNormalized) ||
      actualNormalized.includes(expectedNormalized))
  );
}

function fieldAliases(field: FillableField) {
  return field === "defaultUnitPrice" ? ["price", field] : [field];
}

function sourceLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return value;
  }
}

/**
 * Strict, evidence-backed gate for the unattended auto path only. Manual
 * profile review remains intentionally separate: an operator can explicitly
 * verify a record that does not meet these machine-evidence requirements.
 */
export function evaluateAutoProfileCandidate(input: {
  row: AutoProfileRowIdentity;
  candidate: AiSearchStoredResult;
}): AutoProfileCandidateEvaluation {
  const { row, candidate } = input;
  const reasons: string[] = [];
  const requiredConfidences: number[] = [];
  const trustedSourceUrls = new Set(
    [candidate.url, ...candidate.sourceUrls]
      .map(normalizedUrl)
      .filter((value): value is string => value != null),
  );
  const verifiedCatalogUrls = new Set(
    (candidate.catalogEvidenceUrls ?? [])
      .map(normalizedUrl)
      .filter((value): value is string => value != null && isPdfUrl(value)),
  );
  const catalogUrl = (candidate.catalogPdfUrls ?? [])
    .map(normalizedUrl)
    .find(
      (value): value is string =>
        value != null && isPdfUrl(value) && verifiedCatalogUrls.has(value),
    );
  const sourceUrl = [...trustedSourceUrls][0] ?? null;

  if (!sourceUrl) {
    reasons.push("Không có URL nguồn HTTP(S) đã được truy xuất.");
  }
  if (!catalogUrl) {
    reasons.push(
      "Chưa có URL catalog PDF được xác minh từ nguồn đã truy xuất.",
    );
  }

  const title = candidate.title?.trim() ?? "";
  const specText = candidate.fields.specText?.trim() ?? "";
  if (!title) {
    reasons.push("Nguồn không có tiêu đề sản phẩm để đối chiếu.");
  } else if (bidirectionalOverlap(row.name, title) < 0.45) {
    reasons.push("Tên sản phẩm từ nguồn không khớp đủ với dòng yêu cầu.");
  }
  if (!specText) {
    reasons.push("Nguồn chưa trích xuất được thông số kỹ thuật.");
  } else if (
    bidirectionalOverlap(row.specText, specText) < 0.4 ||
    !hasCompatibleNumbers(row.specText, specText)
  ) {
    reasons.push("Thông số từ nguồn không khớp đủ với dòng yêu cầu.");
  }

  if (normalizeText(row.unit) !== normalizeText(candidate.fields.unit)) {
    reasons.push("ĐVT trích xuất không khớp chính xác với dòng yêu cầu.");
  }

  const requiredFields: Array<[FillableField, string]> = [
    ["unit", "ĐVT"],
    ["specText", "Thông số kỹ thuật"],
    ["manufacturer", "Nhà sản xuất"],
    ["originCountry", "Xuất xứ"],
    ["defaultUnitPrice", "Đơn giá"],
  ];
  if (candidate.fields.code?.trim()) {
    requiredFields.push(["code", "Mã vật tư"]);
  }

  const trustedEvidenceUrls = new Set([
    ...trustedSourceUrls,
    ...verifiedCatalogUrls,
  ]);
  for (const [field, label] of requiredFields) {
    const value = candidate.fields[field]?.trim() ?? "";
    if (!value) {
      reasons.push(`Nguồn chưa có ${label}.`);
      continue;
    }
    const confidence = candidate.fieldConfidences?.[field] ?? 0;
    requiredConfidences.push(confidence);
    if (confidence < AUTO_FIELD_CONFIDENCE) {
      reasons.push(`${label} chưa đạt độ tin cậy 85%.`);
    }
    const evidenced = candidate.evidence.some((evidence) => {
      const evidenceUrl = normalizedUrl(evidence.sourceUrl);
      return (
        fieldAliases(field).includes(evidence.field) &&
        Boolean(evidence.snippet?.trim()) &&
        evidenceUrl != null &&
        trustedEvidenceUrls.has(evidenceUrl) &&
        sameEvidenceValue(field, value, evidence.value)
      );
    });
    if (!evidenced) {
      reasons.push(
        `${label} chưa có bằng chứng trường hợp lệ từ nguồn tin cậy.`,
      );
    }
  }

  const assessment = assessAiCandidate({
    candidate,
    rowName: row.name,
    sheetFields: {
      code: row.code ?? "",
      manufacturer: row.manufacturer ?? "",
      unit: row.unit,
      category: row.category ?? "",
      specText: row.specText,
      originCountry: row.originCountry ?? "",
    },
  });
  if (assessment.score < 0.8) {
    reasons.push("Điểm khớp tổng thể dưới ngưỡng tự động 80%.");
  }
  if (assessment.dimensions.identity < 0.6) {
    reasons.push("Định danh sản phẩm từ nguồn chưa đủ mạnh.");
  }
  if (assessment.dimensions.spec < 0.45) {
    reasons.push("Độ khớp thông số từ nguồn chưa đủ mạnh.");
  }
  if (assessment.dimensions.conflictRisk > 0) {
    reasons.push("Nguồn có dữ liệu mâu thuẫn với dòng yêu cầu.");
  }

  return {
    allowed: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    score: assessment.score,
    confidence: Math.max(
      assessment.score,
      Math.min(...requiredConfidences, AUTO_FIELD_CONFIDENCE),
    ),
    sourceUrl,
    catalogUrl: catalogUrl ?? null,
    evidenceUrls: Array.from(trustedEvidenceUrls),
  };
}

export function autoProfileIdentityMismatchReasons(
  input: Pick<AutoProfileRowIdentity, "name" | "unit" | "specText">,
  candidate: Pick<AutoProfileRowIdentity, "name" | "unit" | "specText">,
) {
  const reasons: string[] = [];
  if (
    candidate.unit.trim() &&
    normalizeText(input.unit) !== normalizeText(candidate.unit)
  ) {
    reasons.push("ĐVT vật tư đã có không khớp với dòng yêu cầu.");
  }
  if (
    candidate.name.trim() &&
    bidirectionalOverlap(input.name, candidate.name) < 0.45
  ) {
    reasons.push("Tên vật tư đã có không khớp với dòng yêu cầu.");
  }
  if (
    candidate.specText.trim() &&
    (bidirectionalOverlap(input.specText, candidate.specText) < 0.4 ||
      !hasCompatibleNumbers(input.specText, candidate.specText))
  ) {
    reasons.push("Thông số vật tư đã có không khớp với dòng yêu cầu.");
  }
  return reasons;
}

export function autoProfileSourceLabel(url: string) {
  return sourceLabel(url);
}
