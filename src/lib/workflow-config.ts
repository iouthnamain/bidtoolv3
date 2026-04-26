export type WorkflowNotificationFrequency = "daily" | "weekly";

export type WorkflowFilterConfig = {
  savedFilterId: number | null;
  savedFilterName: string | null;
  keyword: string;
  provinces: string[];
  categories: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  minMatchScore: number;
  notificationFrequency: WorkflowNotificationFrequency | null;
};

export const emptyWorkflowFilterConfig: WorkflowFilterConfig = {
  savedFilterId: null,
  savedFilterName: null,
  keyword: "",
  provinces: [],
  categories: [],
  budgetMin: null,
  budgetMax: null,
  minMatchScore: 0,
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

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function readFrequency(
  value: unknown,
): WorkflowNotificationFrequency | null {
  if (value === "daily" || value === "weekly") {
    return value;
  }

  return null;
}

export function normalizeWorkflowFilterConfig(
  input: unknown,
): WorkflowFilterConfig {
  if (!isRecord(input)) {
    return { ...emptyWorkflowFilterConfig };
  }

  const savedFilterIdRaw = input.savedFilterId;

  return {
    savedFilterId:
      typeof savedFilterIdRaw === "number" && Number.isInteger(savedFilterIdRaw)
        ? savedFilterIdRaw
        : null,
    savedFilterName: readString(input.savedFilterName) || null,
    keyword: readString(input.keyword),
    provinces: readStringArray(input.provinces),
    categories: readStringArray(input.categories),
    budgetMin: readNumber(input.budgetMin),
    budgetMax: readNumber(input.budgetMax),
    minMatchScore: (() => {
      const raw = readNumber(input.minMatchScore);
      if (raw === null) return 0;
      return Math.max(0, Math.min(100, Math.round(raw)));
    })(),
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

  if (config.keyword) {
    chips.push(`Từ khóa: ${config.keyword}`);
  }

  if (config.provinces.length > 0) {
    chips.push(`Tỉnh: ${config.provinces.length}`);
  }

  if (config.categories.length > 0) {
    chips.push(`Lĩnh vực: ${config.categories.length}`);
  }

  if (config.budgetMin !== null || config.budgetMax !== null) {
    chips.push(
      `Ngân sách: ${
        config.budgetMin !== null
          ? config.budgetMin.toLocaleString("vi-VN")
          : "0"
      } - ${
        config.budgetMax !== null
          ? config.budgetMax.toLocaleString("vi-VN")
          : "không giới hạn"
      }`,
    );
  }

  if (config.minMatchScore > 0) {
    chips.push(`Match tối thiểu: ${config.minMatchScore}%`);
  }

  if (chips.length === 0) {
    chips.push("Điều kiện chung");
  }

  return chips;
}
