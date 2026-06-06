import {
  normalizeCategoryFilterValues,
  normalizeProvinceFilterValues,
} from "~/lib/search-filter-utils";
import { SEARCH_MODE_LABELS, type SearchMode } from "~/lib/search-modes";

export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type SearchCriteria = {
  keyword: string;
  provinces: string[];
  packageCategories: string[];
  classifyIds: number[];
  planFields: string[];
  procurementMethods: string[];
  projectGroups: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  publishedFrom: string;
  publishedTo: string;
  minMatchScore: number;
};

export const emptySearchCriteria: SearchCriteria = {
  keyword: "",
  provinces: [],
  packageCategories: [],
  classifyIds: [],
  planFields: [],
  procurementMethods: [],
  projectGroups: [],
  budgetMin: null,
  budgetMax: null,
  publishedFrom: "",
  publishedTo: "",
  minMatchScore: 0,
};

export function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeStringList(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "vi"));
}

export function parsePositiveInt(
  value: string | null,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export function parsePositiveId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function parseMinMatch(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, parsed));
}

export function parseOptionalNumber(
  value: string | null | undefined,
): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function isValidDateFilterValue(value: string): boolean {
  if (!DATE_ONLY_REGEX.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

export function normalizeDateFilterValue(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  return isValidDateFilterValue(trimmed) ? trimmed : "";
}

export function normalizeSearchCriteria(
  input: Partial<SearchCriteria>,
): SearchCriteria {
  const budgetMin =
    typeof input.budgetMin === "number" && Number.isFinite(input.budgetMin)
      ? Math.max(0, Math.round(input.budgetMin))
      : null;
  const budgetMax =
    typeof input.budgetMax === "number" && Number.isFinite(input.budgetMax)
      ? Math.max(0, Math.round(input.budgetMax))
      : null;

  return {
    keyword: input.keyword?.trim() ?? "",
    provinces: normalizeProvinceFilterValues(input.provinces ?? []),
    packageCategories: normalizeCategoryFilterValues(
      input.packageCategories ?? [],
    ),
    classifyIds: Array.from(
      new Set(
        (input.classifyIds ?? []).filter(
          (value): value is number => Number.isInteger(value) && value > 0,
        ),
      ),
    ).sort((a, b) => a - b),
    planFields: normalizeStringList(input.planFields ?? []),
    procurementMethods: normalizeStringList(input.procurementMethods ?? []),
    projectGroups: normalizeStringList(input.projectGroups ?? []),
    budgetMin,
    budgetMax,
    publishedFrom: normalizeDateFilterValue(input.publishedFrom),
    publishedTo: normalizeDateFilterValue(input.publishedTo),
    minMatchScore: Math.max(
      0,
      Math.min(100, Math.round(input.minMatchScore ?? 0)),
    ),
  };
}

export function buildCriteriaFromLegacyPackageFields(input: {
  keyword?: string;
  provinces?: string[];
  categories?: string[];
  budgetMin?: number | null;
  budgetMax?: number | null;
  minMatchScore?: number;
}): SearchCriteria {
  return normalizeSearchCriteria({
    keyword: input.keyword ?? "",
    provinces: input.provinces ?? [],
    packageCategories: input.categories ?? [],
    budgetMin: input.budgetMin ?? null,
    budgetMax: input.budgetMax ?? null,
    minMatchScore: input.minMatchScore ?? 0,
  });
}

function parseMultiValueParam(
  searchParams: Pick<URLSearchParams, "get" | "getAll">,
  key: string,
): string[] {
  const repeated = searchParams
    .getAll(key)
    .map((item) => item.trim())
    .filter(Boolean);

  if (repeated.length > 1) {
    return normalizeStringList(repeated);
  }

  if (repeated.length === 1) {
    return normalizeStringList(parseCsvList(repeated[0] ?? ""));
  }

  const legacy = searchParams.get(key);
  if (!legacy) {
    return [];
  }

  return normalizeStringList(parseCsvList(legacy));
}

function parseIntegerList(
  searchParams: Pick<URLSearchParams, "get" | "getAll">,
  key: string,
): number[] {
  const values = parseMultiValueParam(searchParams, key)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function readSearchModeFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): SearchMode {
  const value = searchParams.get("mode");

  if (
    value === "package_keyword" ||
    value === "package_location" ||
    value === "package_area_location" ||
    value === "plan" ||
    value === "project"
  ) {
    return value;
  }

  return "package_keyword";
}

export function readSearchCriteriaFromSearchParams(
  searchParams: Pick<URLSearchParams, "get" | "getAll">,
): SearchCriteria {
  return normalizeSearchCriteria({
    keyword: searchParams.get("keyword") ?? "",
    provinces: parseMultiValueParam(searchParams, "province"),
    packageCategories: parseMultiValueParam(searchParams, "category"),
    classifyIds: parseIntegerList(searchParams, "classifyId"),
    planFields: parseMultiValueParam(searchParams, "field"),
    procurementMethods: parseMultiValueParam(searchParams, "procurementMethod"),
    projectGroups: parseMultiValueParam(searchParams, "projectGroup"),
    budgetMin: parseOptionalNumber(searchParams.get("budgetMin")),
    budgetMax: parseOptionalNumber(searchParams.get("budgetMax")),
    publishedFrom: searchParams.get("publishedFrom") ?? "",
    publishedTo: searchParams.get("publishedTo") ?? "",
    minMatchScore: parseMinMatch(searchParams.get("minMatchScore")),
  });
}

export function appendMultiValueParams(
  params: URLSearchParams,
  key: string,
  values: string[],
) {
  for (const value of normalizeStringList(values)) {
    params.append(key, value);
  }
}

export function appendIntegerParams(
  params: URLSearchParams,
  key: string,
  values: number[],
) {
  for (const value of Array.from(new Set(values)).sort((a, b) => a - b)) {
    params.append(key, String(value));
  }
}

export function buildSearchUrlParams(options: {
  mode: SearchMode;
  criteria: SearchCriteria;
  page?: number;
  limit?: number;
  sortOrder?: "asc" | "desc";
  savedFilterId?: number | null;
}) {
  const criteria = normalizeSearchCriteria(options.criteria);
  const params = new URLSearchParams();

  if (options.mode !== "package_keyword") {
    params.set("mode", options.mode);
  }

  if (criteria.keyword) {
    params.set("keyword", criteria.keyword);
  }

  appendMultiValueParams(params, "province", criteria.provinces);
  appendMultiValueParams(params, "category", criteria.packageCategories);
  appendIntegerParams(params, "classifyId", criteria.classifyIds);
  appendMultiValueParams(params, "field", criteria.planFields);
  appendMultiValueParams(
    params,
    "procurementMethod",
    criteria.procurementMethods,
  );
  appendMultiValueParams(params, "projectGroup", criteria.projectGroups);

  if (criteria.budgetMin !== null) {
    params.set("budgetMin", String(criteria.budgetMin));
  }

  if (criteria.budgetMax !== null) {
    params.set("budgetMax", String(criteria.budgetMax));
  }

  if (criteria.publishedFrom) {
    params.set("publishedFrom", criteria.publishedFrom);
  }

  if (criteria.publishedTo) {
    params.set("publishedTo", criteria.publishedTo);
  }

  if (criteria.minMatchScore > 0) {
    params.set("minMatchScore", String(criteria.minMatchScore));
  }

  if (options.savedFilterId) {
    params.set("savedFilterId", String(options.savedFilterId));
  }

  if (options.sortOrder === "asc") {
    params.set("sortOrder", "asc");
  }

  if (typeof options.page === "number" && options.page > 1) {
    params.set("page", String(options.page));
  }

  if (typeof options.limit === "number" && options.limit > 0) {
    params.set("limit", String(options.limit));
  }

  return params;
}

export function buildSearchHref(options: {
  mode: SearchMode;
  criteria: SearchCriteria;
  savedFilterId?: number | null;
}) {
  const params = buildSearchUrlParams(options);
  const query = params.toString();
  return `/search${query ? `?${query}` : ""}`;
}

function formatCurrencyRange(min: number | null, max: number | null): string {
  return `Ngân sách: ${
    min !== null ? min.toLocaleString("vi-VN") : "0"
  } - ${max !== null ? max.toLocaleString("vi-VN") : "không giới hạn"}`;
}

export function summarizeSearchCriteria(
  mode: SearchMode,
  criteriaInput: SearchCriteria,
): string[] {
  const criteria = normalizeSearchCriteria(criteriaInput);
  const chips: string[] = [];

  chips.push(`Chế độ: ${SEARCH_MODE_LABELS[mode]}`);

  if (criteria.keyword) {
    chips.push(`Từ khóa: ${criteria.keyword}`);
  }

  if (criteria.provinces.length > 0) {
    chips.push(`Tỉnh: ${criteria.provinces.length} mục`);
  }

  if (criteria.packageCategories.length > 0) {
    chips.push(`Lĩnh vực gói: ${criteria.packageCategories.length} mục`);
  }

  if (criteria.classifyIds.length > 0) {
    chips.push(`Ngành nghề: ${criteria.classifyIds.length} mục`);
  }

  if (criteria.planFields.length > 0) {
    chips.push(`Lĩnh vực KHLCNT: ${criteria.planFields.length} mục`);
  }

  if (criteria.procurementMethods.length > 0) {
    chips.push(`HTLCNT: ${criteria.procurementMethods.length} mục`);
  }

  if (criteria.projectGroups.length > 0) {
    chips.push(`Nhóm dự án: ${criteria.projectGroups.length} mục`);
  }

  if (criteria.budgetMin !== null || criteria.budgetMax !== null) {
    chips.push(formatCurrencyRange(criteria.budgetMin, criteria.budgetMax));
  }

  if (criteria.publishedFrom || criteria.publishedTo) {
    chips.push(
      `Ngày: ${criteria.publishedFrom || "không giới hạn"} - ${
        criteria.publishedTo || "không giới hạn"
      }`,
    );
  }

  if (criteria.minMatchScore > 0) {
    chips.push(`Match tối thiểu: ${criteria.minMatchScore}%`);
  }

  return chips;
}
