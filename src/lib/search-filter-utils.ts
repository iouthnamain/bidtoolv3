import { CATEGORY_OPTIONS, PROVINCE_OPTIONS } from "~/constants/search-options";

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProvinceKey(input: string): string {
  return normalizeText(input)
    .replace(/^thanh pho\s+/, "")
    .replace(/^tinh\s+/, "")
    .replace(/^tp\.?\s*/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeCategoryKey(input: string): string {
  return normalizeText(input).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const canonicalProvinceMap = new Map<string, string>(
  PROVINCE_OPTIONS.map((value) => [normalizeProvinceKey(value), value]),
);

const canonicalCategoryMap = new Map<string, string>(
  CATEGORY_OPTIONS.map((value) => [normalizeCategoryKey(value), value]),
);

function sortVietnamese(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b, "vi"));
}

function normalizeValues(
  values: string[],
  normalizeKey: (value: string) => string,
  canonicalMap: Map<string, string>,
) {
  const normalized = new Map<string, string>();
  let unknownCount = 0;

  for (const rawValue of values) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }

    const key = normalizeKey(trimmed);
    const canonical = canonicalMap.get(key);

    if (canonical) {
      normalized.set(`known:${canonical}`, canonical);
      continue;
    }

    unknownCount += 1;
    normalized.set(`unknown:${key || trimmed.toLowerCase()}`, trimmed);
  }

  return {
    values: sortVietnamese(normalized.values()),
    unknownCount,
  };
}

export function canonicalizeProvinceLabel(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  return canonicalProvinceMap.get(normalizeProvinceKey(trimmed)) ?? null;
}

export function normalizeProvinceFilterValues(values: string[]): string[] {
  const normalized = normalizeValues(
    values,
    normalizeProvinceKey,
    canonicalProvinceMap,
  );

  const canonicalSelection = new Set(
    normalized.values
      .map((value) => canonicalizeProvinceLabel(value))
      .filter((value): value is string => Boolean(value)),
  );

  if (
    normalized.unknownCount === 0 &&
    canonicalSelection.size === PROVINCE_OPTIONS.length
  ) {
    return [];
  }

  return normalized.values;
}

export function normalizeCategoryFilterValues(values: string[]): string[] {
  const normalized = normalizeValues(
    values,
    normalizeCategoryKey,
    canonicalCategoryMap,
  );

  const canonicalSelection = new Set(
    normalized.values
      .map((value) => canonicalCategoryMap.get(normalizeCategoryKey(value)))
      .filter((value): value is string => Boolean(value)),
  );

  if (
    normalized.unknownCount === 0 &&
    canonicalSelection.size === CATEGORY_OPTIONS.length
  ) {
    return [];
  }

  return normalized.values;
}

export function normalizeSearchSelections<
  T extends {
    provinces: string[];
    categories: string[];
  },
>(input: T): T {
  return {
    ...input,
    provinces: normalizeProvinceFilterValues(input.provinces),
    categories: normalizeCategoryFilterValues(input.categories),
  };
}

