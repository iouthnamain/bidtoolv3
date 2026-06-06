import {
  buildCriteriaFromLegacyPackageFields,
  emptySearchCriteria,
  normalizeSearchCriteria,
  summarizeSearchCriteria,
  type SearchCriteria,
} from "~/lib/search-criteria";
import { SEARCH_MODE_LABELS, type SearchMode } from "~/lib/search-modes";

export type WorkflowNotificationFrequency = "daily" | "weekly";

export type WorkflowFilterConfig = {
  searchMode: SearchMode;
  criteria: SearchCriteria;
  savedFilterId: number | null;
  savedFilterName: string | null;
  notificationFrequency: WorkflowNotificationFrequency | null;
};

export const emptyWorkflowFilterConfig: WorkflowFilterConfig = {
  searchMode: "package_keyword",
  criteria: { ...emptySearchCriteria },
  savedFilterId: null,
  savedFilterName: null,
  notificationFrequency: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is number =>
      typeof item === "number" && Number.isInteger(item),
  );
}

function readFrequency(value: unknown): WorkflowNotificationFrequency | null {
  if (value === "daily" || value === "weekly") {
    return value;
  }

  return null;
}

function readSearchMode(value: unknown): SearchMode {
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

export function normalizeWorkflowFilterConfig(
  input: unknown,
): WorkflowFilterConfig {
  if (!isRecord(input)) {
    return { ...emptyWorkflowFilterConfig };
  }

  const nestedCriteria = isRecord(input.criteria) ? input.criteria : input;
  const legacyCriteria = buildCriteriaFromLegacyPackageFields({
    keyword: readString(input.keyword),
    provinces: readStringArray(input.provinces),
    categories: readStringArray(input.categories),
    budgetMin: readNumber(input.budgetMin),
    budgetMax: readNumber(input.budgetMax),
    minMatchScore: readNumber(input.minMatchScore) ?? 0,
  });

  const searchMode = readSearchMode(input.searchMode);
  const savedFilterIdRaw = input.savedFilterId;

  return {
    searchMode,
    criteria: normalizeSearchCriteria({
      ...legacyCriteria,
      keyword: readString(nestedCriteria.keyword) || legacyCriteria.keyword,
      provinces:
        readStringArray(nestedCriteria.provinces).length > 0
          ? readStringArray(nestedCriteria.provinces)
          : legacyCriteria.provinces,
      packageCategories:
        readStringArray(nestedCriteria.packageCategories).length > 0
          ? readStringArray(nestedCriteria.packageCategories)
          : readStringArray(input.categories).length > 0
            ? readStringArray(input.categories)
            : legacyCriteria.packageCategories,
      classifyIds: readNumberArray(nestedCriteria.classifyIds),
      planFields: readStringArray(nestedCriteria.planFields),
      procurementMethods: readStringArray(nestedCriteria.procurementMethods),
      projectGroups: readStringArray(nestedCriteria.projectGroups),
      budgetMin:
        readNumber(nestedCriteria.budgetMin) ?? legacyCriteria.budgetMin,
      budgetMax:
        readNumber(nestedCriteria.budgetMax) ?? legacyCriteria.budgetMax,
      publishedFrom: readString(nestedCriteria.publishedFrom),
      publishedTo: readString(nestedCriteria.publishedTo),
      minMatchScore:
        readNumber(nestedCriteria.minMatchScore) ??
        legacyCriteria.minMatchScore,
    }),
    savedFilterId:
      typeof savedFilterIdRaw === "number" && Number.isInteger(savedFilterIdRaw)
        ? savedFilterIdRaw
        : null,
    savedFilterName: readString(input.savedFilterName) || null,
    notificationFrequency: readFrequency(input.notificationFrequency),
  };
}

export function summarizeWorkflowFilterConfig(
  config: WorkflowFilterConfig,
): string[] {
  const chips: string[] = [];

  if (config.savedFilterName) {
    chips.push(`Smart View: ${config.savedFilterName}`);
  }

  const modeSummary = summarizeSearchCriteria(
    config.searchMode,
    config.criteria,
  );
  chips.push(...modeSummary);

  if (chips.length === 0) {
    chips.push(`Chế độ: ${SEARCH_MODE_LABELS.package_keyword}`);
  }

  return chips;
}
