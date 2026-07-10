/**
 * Client-safe contract for the automatic material-profile workflow.
 *
 * Keep this module free of database, Excel, and server-only imports: the profile
 * UI, worker services, and export builder all need to agree on the same identity
 * requirements and promotion gate.
 */

export const PROFILE_REQUIRED_INPUT_FIELDS = [
  "Tên vật tư",
  "ĐVT",
  "Thông số kỹ thuật",
] as const;

/** Backward-compatible explicit name used by profile tests and worker code. */
export const MATERIAL_PROFILE_REQUIRED_IDENTITY_FIELDS =
  PROFILE_REQUIRED_INPUT_FIELDS;

export const CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS = [
  "Mã vật tư",
  "Tên vật tư",
  "ĐVT",
  "Thông số kỹ thuật",
  "Nhà sản xuất",
  "Xuất xứ",
  "Đơn giá",
  "Nguồn",
  "URL catalog",
  "Độ tin cậy",
  "Trạng thái",
] as const;

/** Backward-compatible explicit name used by profile tests and worker code. */
export const MATERIAL_PROFILE_CLEAN_EXPORT_COLUMNS =
  CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS;

export type MaterialProfileInput = {
  name: string;
  unit: string;
  specText: string;
  rowIndex?: number;
  sourceValues?: Record<string, unknown>;
};

export type MaterialProfileCandidate = {
  code?: string | null;
  name?: string | null;
  unit?: string | null;
  specText?: string | null;
  manufacturer?: string | null;
  originCountry?: string | null;
  unitPrice?: number | null;
  source?: string | null;
  sourceUrl?: string | null;
  catalogUrl?: string | null;
  evidenceUrls?: string[] | null;
  confidence?: number | null;
  provenance?: string | null;
  codeProvenance?: string | null;
};

export type MaterialProfileInputValidation = {
  valid: boolean;
  missingFields: Array<(typeof PROFILE_REQUIRED_INPUT_FIELDS)[number]>;
};

export type MaterialProfileResolution = {
  candidate: MaterialProfileCandidate;
  complete: boolean;
  promotable: boolean;
  status: "saved" | "needs_verification";
  reasons: string[];
};

export type MaterialProfileCleanExportRow = Record<
  (typeof CLEAN_MATERIAL_PROFILE_EXPORT_HEADERS)[number],
  string | number
>;

const AUTO_PROMOTION_CONFIDENCE = 0.85;

function primitiveText(value: unknown) {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}

function normalizeText(value: unknown) {
  return primitiveText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ")
    .trim();
}

function displayText(value: unknown) {
  return primitiveText(value).replace(/\s+/g, " ").trim();
}

function isPresent(value: unknown) {
  return displayText(value).length > 0;
}

function isHttpUrl(value: unknown) {
  const text = displayText(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function stableHash(value: string) {
  // Deterministic and dependency-free. It is an identity key, not a secret.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

function sameUnit(left: unknown, right: unknown) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return (
    normalizedLeft.length > 0 &&
    normalizedRight.length > 0 &&
    normalizedLeft === normalizedRight
  );
}

function normalizedCandidate(
  input: MaterialProfileInput,
  candidate: MaterialProfileCandidate,
  allowGeneratedCode: boolean,
): MaterialProfileCandidate {
  const hasCode = isPresent(candidate.code);
  const code =
    hasCode || !allowGeneratedCode
      ? displayText(candidate.code) || undefined
      : createMaterialProfileGeneratedCode(input);
  const generatedCode = !hasCode && Boolean(code);

  return {
    ...candidate,
    code,
    name: displayText(candidate.name) || displayText(input.name),
    unit: displayText(candidate.unit) || displayText(input.unit),
    specText: displayText(candidate.specText) || displayText(input.specText),
    manufacturer: displayText(candidate.manufacturer) || undefined,
    originCountry: displayText(candidate.originCountry) || undefined,
    source: displayText(candidate.source) || undefined,
    sourceUrl: displayText(candidate.sourceUrl) || undefined,
    catalogUrl: displayText(candidate.catalogUrl) || undefined,
    evidenceUrls: (candidate.evidenceUrls ?? [])
      .map(displayText)
      .filter(Boolean),
    confidence:
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence)
        ? Math.min(1, Math.max(0, candidate.confidence))
        : 0,
    provenance:
      generatedCode && !isPresent(candidate.provenance)
        ? "generated"
        : displayText(candidate.provenance) || undefined,
    codeProvenance: generatedCode
      ? "generated"
      : displayText(candidate.codeProvenance) || undefined,
  };
}

export function validateMaterialProfileInput(
  input: MaterialProfileInput,
): MaterialProfileInputValidation {
  const sourceValues = [input.name, input.unit, input.specText];
  const missingFields = PROFILE_REQUIRED_INPUT_FIELDS.filter(
    (_, index) => !isPresent(sourceValues[index]),
  );

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

export function createMaterialProfileSourceFingerprint(
  input: MaterialProfileInput,
) {
  return [
    Math.trunc(input.rowIndex ?? 0),
    createMaterialProfileProductFingerprint(input),
  ].join("|");
}

/**
 * Stable material identity independent of where the material appeared in a
 * workbook. Row identity belongs to source fingerprints; catalog codes and
 * dedupe must stay the same when the same material is repeated or imported
 * again from another sheet.
 */
export function createMaterialProfileProductFingerprint(
  input: Pick<MaterialProfileInput, "name" | "unit" | "specText">,
) {
  return [
    normalizeText(input.name),
    normalizeText(input.unit),
    normalizeText(input.specText),
  ].join("|");
}

export function createMaterialProfileGeneratedCode(
  input: MaterialProfileInput,
) {
  return `BT-${stableHash(createMaterialProfileProductFingerprint(input))}`;
}

export function validateMaterialProfileResolution(input: {
  input: MaterialProfileInput;
  candidate: MaterialProfileCandidate;
  promotionConfidence?: number;
}): MaterialProfileResolution {
  const inputValidation = validateMaterialProfileInput(input.input);
  const candidate = normalizedCandidate(
    input.input,
    input.candidate,
    inputValidation.valid,
  );
  const reasons: string[] = [];

  if (!inputValidation.valid) {
    reasons.push(`Thiếu ${inputValidation.missingFields.join(", ")}.`);
  }

  if (!sameUnit(input.input.unit, candidate.unit)) {
    reasons.push("ĐVT kết quả không tương thích với dòng đầu vào.");
  }

  const requiredCandidateFields: Array<
    [keyof MaterialProfileCandidate, string]
  > = [
    ["code", "Mã vật tư"],
    ["name", "Tên vật tư"],
    ["unit", "ĐVT"],
    ["specText", "Thông số kỹ thuật"],
    ["manufacturer", "Nhà sản xuất"],
    ["originCountry", "Xuất xứ"],
    ["source", "Nguồn"],
    ["sourceUrl", "URL nguồn"],
    ["catalogUrl", "URL catalog"],
  ];
  const missingOutputFields = requiredCandidateFields
    .filter(([field]) => !isPresent(candidate[field]))
    .map(([, label]) => label);
  if (
    typeof candidate.unitPrice !== "number" ||
    !Number.isFinite(candidate.unitPrice) ||
    candidate.unitPrice < 0
  ) {
    missingOutputFields.push("Đơn giá");
  }
  if (missingOutputFields.length > 0) {
    reasons.push(`Chưa đủ dữ liệu: ${missingOutputFields.join(", ")}.`);
  }

  if (isPresent(candidate.sourceUrl) && !isHttpUrl(candidate.sourceUrl)) {
    reasons.push("URL nguồn không hợp lệ.");
  }
  if (isPresent(candidate.catalogUrl) && !isHttpUrl(candidate.catalogUrl)) {
    reasons.push("URL catalog không hợp lệ.");
  }

  const evidence = new Set(
    [
      candidate.catalogUrl,
      candidate.sourceUrl,
      ...(candidate.evidenceUrls ?? []),
    ]
      .map(displayText)
      .filter(Boolean),
  );
  if (evidence.size === 0) {
    reasons.push("Chưa có bằng chứng nguồn để kiểm tra.");
  }

  const confidenceThreshold =
    input.promotionConfidence ?? AUTO_PROMOTION_CONFIDENCE;
  if ((candidate.confidence ?? 0) < confidenceThreshold) {
    reasons.push(
      `Độ tin cậy dưới ngưỡng ${Math.round(confidenceThreshold * 100)}%.`,
    );
  }

  const complete = missingOutputFields.length === 0;
  const promotable = inputValidation.valid && complete && reasons.length === 0;
  return {
    candidate,
    complete,
    promotable,
    status: promotable ? "saved" : "needs_verification",
    reasons,
  };
}

/** Alias retained for callers that phrase the workflow as resolving a row. */
export const resolveMaterialProfileOutput = validateMaterialProfileResolution;

export function toMaterialProfileCleanExportRow(input: {
  input: MaterialProfileInput;
  candidate: MaterialProfileCandidate;
  resolution?: MaterialProfileResolution;
}): MaterialProfileCleanExportRow {
  const resolution =
    input.resolution ??
    validateMaterialProfileResolution({
      input: input.input,
      candidate: input.candidate,
    });
  const candidate = resolution.candidate;
  return {
    "Mã vật tư": displayText(candidate.code),
    "Tên vật tư": displayText(candidate.name) || displayText(input.input.name),
    ĐVT: displayText(candidate.unit) || displayText(input.input.unit),
    "Thông số kỹ thuật":
      displayText(candidate.specText) || displayText(input.input.specText),
    "Nhà sản xuất": displayText(candidate.manufacturer),
    "Xuất xứ": displayText(candidate.originCountry),
    "Đơn giá":
      typeof candidate.unitPrice === "number" &&
      Number.isFinite(candidate.unitPrice)
        ? candidate.unitPrice
        : "",
    Nguồn: displayText(candidate.source) || displayText(candidate.sourceUrl),
    "URL catalog": displayText(candidate.catalogUrl),
    "Độ tin cậy": `${Math.round((candidate.confidence ?? 0) * 100)}%`,
    "Trạng thái": resolution.status === "saved" ? "Đã lưu" : "Cần xác minh",
  };
}

/** Alias retained for the shorter export-builder naming style. */
export const toCleanMaterialProfileExportRow = toMaterialProfileCleanExportRow;
