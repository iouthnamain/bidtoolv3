"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

import {
  CATEGORY_OPTIONS,
  KEYWORD_OPTIONS,
  PAGE_SIZE_OPTIONS,
  PROVINCE_OPTIONS,
  type SortBy,
  type SortOrder,
} from "~/constants/search-options";
import {
  normalizeCategoryFilterValues,
  normalizeProvinceFilterValues,
  normalizeSearchSelections,
} from "~/lib/search-filter-utils";
import { Button, EmptyState, FilterField } from "~/app/_components/ui";
import { type RouterOutputs, api } from "~/trpc/react";

type FilterState = {
  keyword: string;
  provinces: string[];
  categories: string[];
  budgetMin: string;
  budgetMax: string;
  publishedFrom: string;
  publishedTo: string;
  minMatchScore: number;
};

type SavedFilterRecord = RouterOutputs["search"]["getSavedFilter"];

type AppliedFilterChipId =
  | "keyword"
  | "provinces"
  | "categories"
  | "budget"
  | "publishedAt"
  | "minMatchScore";

type AppliedFilterChip = {
  id: AppliedFilterChipId;
  label: string;
};

const LEGACY_SORT_FIELDS: SortBy[] = [
  "budget",
  "matchScore",
  "title",
  "inviter",
];

const LOCAL_REFINEMENT_LABELS: Record<AppliedFilterChipId, string> = {
  keyword: "từ khóa",
  provinces: "tỉnh/thành",
  categories: "lĩnh vực",
  budget: "ngân sách",
  publishedAt: "ngày đăng",
  minMatchScore: "điểm match",
};

const smartViewFrequencyLabels = {
  daily: "Hằng ngày",
  weekly: "Hằng tuần",
} as const;

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parsePositiveId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseMinMatch(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, parsed));
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function isValidDateFilterValue(value: string): boolean {
  if (!DATE_ONLY_REGEX.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function normalizeDateFilterValue(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  return isValidDateFilterValue(trimmed) ? trimmed : "";
}

function parseOptionalDateFilter(value: string): string | undefined {
  const normalized = normalizeDateFilterValue(value);
  return normalized || undefined;
}

function formatDateFilterValue(value: string): string {
  const normalized = normalizeDateFilterValue(value);
  if (!normalized) {
    return value;
  }

  const [yearText = "", monthText = "", dayText = ""] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  return new Date(year, month - 1, day).toLocaleDateString("vi-VN");
}

function normalizeFilterState(input: FilterState): FilterState {
  const normalized = normalizeSearchSelections(input);

  return {
    ...normalized,
    publishedFrom: normalizeDateFilterValue(input.publishedFrom),
    publishedTo: normalizeDateFilterValue(input.publishedTo),
  };
}

function buildFilterStateFromSavedFilter(
  filter: Pick<
    SavedFilterRecord,
    | "keyword"
    | "provinces"
    | "categories"
    | "budgetMin"
    | "budgetMax"
    | "minMatchScore"
  >,
): FilterState {
  return normalizeFilterState({
    keyword: filter.keyword,
    provinces: filter.provinces,
    categories: filter.categories,
    budgetMin:
      typeof filter.budgetMin === "number" ? String(filter.budgetMin) : "",
    budgetMax:
      typeof filter.budgetMax === "number" ? String(filter.budgetMax) : "",
    publishedFrom: "",
    publishedTo: "",
    minMatchScore: Math.max(0, Math.min(100, filter.minMatchScore)),
  });
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStringList(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "vi"));
}

function areSameStringLists(a: string[], b: string[]): boolean {
  const na = normalizeStringList(a);
  const nb = normalizeStringList(b);

  if (na.length !== nb.length) {
    return false;
  }

  return na.every((value, index) => value === nb[index]);
}

function areSamePersistableFilters(a: FilterState, b: FilterState): boolean {
  return (
    a.keyword === b.keyword &&
    areSameStringLists(a.provinces, b.provinces) &&
    areSameStringLists(a.categories, b.categories) &&
    a.budgetMin === b.budgetMin &&
    a.budgetMax === b.budgetMax &&
    a.minMatchScore === b.minMatchScore
  );
}

function areSameSearchFilters(a: FilterState, b: FilterState): boolean {
  return (
    areSamePersistableFilters(a, b) &&
    a.publishedFrom === b.publishedFrom &&
    a.publishedTo === b.publishedTo
  );
}

function parseMultiValueParam(
  searchParams: ReadonlyURLSearchParams,
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
    const only = repeated[0] ?? "";
    // Backward compatible for previous CSV query format.
    return normalizeStringList(parseCsvList(only));
  }

  const legacy = searchParams.get(key);
  if (!legacy) {
    return [];
  }

  return normalizeStringList(parseCsvList(legacy));
}

function appendMultiValueParams(
  params: URLSearchParams,
  key: string,
  values: string[],
) {
  for (const value of normalizeStringList(values)) {
    params.append(key, value);
  }
}

function formatCurrency(value: number): string {
  return `${Number(value).toLocaleString("vi-VN")} VNĐ`;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : parseBidWinnerDateTime(value);
  if (!date) {
    return "-";
  }
  return date.toLocaleDateString("vi-VN");
}

function formatDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : parseBidWinnerDateTime(value);
  if (!date) {
    return "-";
  }
  return date.toLocaleString("vi-VN");
}

function parseBidWinnerDateTime(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function readFiltersFromSearchParams(
  searchParams: ReadonlyURLSearchParams,
): FilterState {
  return normalizeFilterState({
    keyword: searchParams.get("keyword") ?? "",
    provinces: parseMultiValueParam(searchParams, "province"),
    categories: parseMultiValueParam(searchParams, "category"),
    budgetMin: searchParams.get("budgetMin") ?? "",
    budgetMax: searchParams.get("budgetMax") ?? "",
    publishedFrom: searchParams.get("publishedFrom") ?? "",
    publishedTo: searchParams.get("publishedTo") ?? "",
    minMatchScore: parseMinMatch(searchParams.get("minMatchScore")),
  });
}

function usesLegacySort(value: string | null): boolean {
  return Boolean(value && LEGACY_SORT_FIELDS.includes(value as SortBy));
}

function usesUnsupportedSourceSortParams(
  searchParams: ReadonlyURLSearchParams,
): boolean {
  return (
    usesLegacySort(searchParams.get("sortBy")) ||
    searchParams.get("sortOrder") === "asc"
  );
}

function hasExactFilterChanges(
  current: FilterState,
  next: FilterState,
): boolean {
  return !areSameStringLists(current.provinces, next.provinces);
}

type StatusBadge = {
  label: string;
  className: string;
  level: "normal" | "important" | "critical";
};

function getImportantStatuses(item: {
  budget: number;
  matchScore: number;
  publishedAt: string;
  closingAt: string | null;
}): StatusBadge[] {
  const badges: StatusBadge[] = [];

  if (item.matchScore >= 85) {
    badges.push({
      label: "Match cao",
      className:
        "border-emerald-300 bg-emerald-100 text-emerald-700 font-semibold",
      level: "important",
    });
  }

  if (item.budget >= 10_000_000_000) {
    badges.push({
      label: "Gói lớn",
      className: "border-amber-300 bg-amber-100 text-amber-700 font-semibold",
      level: "important",
    });
  }

  const publishedAt = parseBidWinnerDateTime(item.publishedAt);
  if (publishedAt) {
    const hoursFromPublish =
      (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);
    if (hoursFromPublish <= 24) {
      badges.push({
        label: "Mới đăng",
        className: "border-blue-300 bg-blue-100 text-blue-700",
        level: "normal",
      });
    }
  }

  const closingAt = parseBidWinnerDateTime(item.closingAt);
  if (closingAt) {
    const hoursToClose = (closingAt.getTime() - Date.now()) / (1000 * 60 * 60);

    if (hoursToClose < 0) {
      badges.push({
        label: "Đã đóng",
        className: "border-slate-300 bg-slate-100 text-slate-600",
        level: "normal",
      });
    } else if (hoursToClose <= 48) {
      badges.push({
        label: "Sắp đóng",
        className: "border-rose-400 bg-rose-100 text-rose-700 font-bold",
        level: "critical",
      });
    }
  }

  return badges;
}

function mergeSelectOptions(
  staticOptions: readonly string[],
  dynamicOptions: string[] = [],
  selected: string[] = [],
) {
  const merged = new Set<string>([
    ...normalizeStringList([...staticOptions]),
    ...normalizeStringList(dynamicOptions),
  ]);
  for (const value of selected) {
    if (value.trim()) {
      merged.add(value.trim());
    }
  }
  return Array.from(merged).sort((a, b) => a.localeCompare(b, "vi"));
}

function summarizeSelected(values: string[], fallback: string): string {
  if (values.length === 0) {
    return fallback;
  }

  if (values.length <= 2) {
    return values.join(", ");
  }

  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

type MultiSelectDropdownProps = {
  id?: string;
  ariaLabel?: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
};

function MultiSelectDropdown({
  id,
  ariaLabel,
  options,
  selected,
  onChange,
  emptyLabel,
}: MultiSelectDropdownProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return options;
    }

    return options.filter((item) => item.toLowerCase().includes(keyword));
  }, [options, query]);

  const toggleItem = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }

    onChange(normalizeStringList([...selected, value]));
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm transition-colors duration-150 hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="truncate">
          {summarizeSelected(selected, emptyLabel)}
        </span>
        <span className="ml-2 shrink-0 text-xs text-slate-500">
          {selected.length}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <input
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
            placeholder="Tìm nhanh..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="mt-2 flex items-center justify-between text-xs">
            <button
              type="button"
              className="rounded text-sky-700 transition-colors hover:text-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
              onClick={() => onChange(options)}
            >
              Chọn tất cả
            </button>
            <button
              type="button"
              className="rounded text-slate-500 transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
              onClick={() => onChange([])}
            >
              Bỏ chọn
            </button>
          </div>

          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
            {filteredOptions.length === 0 ? (
              <p className="text-xs text-slate-500">Không có mục phù hợp.</p>
            ) : (
              filteredOptions.map((item) => (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-100"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(item)}
                    onChange={() => toggleItem(item)}
                  />
                  <span className="text-sm text-slate-700">{item}</span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SearchPageClient() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const initialFilters = readFiltersFromSearchParams(searchParams);
  const activeSavedFilterId = parsePositiveId(searchParams.get("savedFilterId"));

  const [keyword, setKeyword] = useState(initialFilters.keyword);
  const [provinces, setProvinces] = useState(initialFilters.provinces);
  const [categories, setCategories] = useState(initialFilters.categories);
  const [budgetMin, setBudgetMin] = useState(initialFilters.budgetMin);
  const [budgetMax, setBudgetMax] = useState(initialFilters.budgetMax);
  const [publishedFrom, setPublishedFrom] = useState(
    initialFilters.publishedFrom,
  );
  const [publishedTo, setPublishedTo] = useState(initialFilters.publishedTo);
  const [minMatchScore, setMinMatchScore] = useState(
    initialFilters.minMatchScore,
  );
  const [appliedFilters, setAppliedFilters] =
    useState<FilterState>(initialFilters);
  const sortBy: SortBy = "publishedAt";
  const [sortDowngraded, setSortDowngraded] = useState<boolean>(() =>
    usesUnsupportedSourceSortParams(searchParams),
  );
  const sortOrder: SortOrder = "desc";
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() =>
    parsePositiveInt(searchParams.get("limit"), 20),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [smartViewSuccess, setSmartViewSuccess] = useState<string | null>(null);
  const [saveSelectedSuccess, setSaveSelectedSuccess] = useState<string | null>(
    null,
  );
  const [saveSelectedError, setSaveSelectedError] = useState<string | null>(
    null,
  );
  const [smartViewName, setSmartViewName] = useState("");
  const [smartViewFrequency, setSmartViewFrequency] = useState<
    "daily" | "weekly"
  >("daily");
  const [selectedExternalIds, setSelectedExternalIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const handleProvinceChange = useCallback((next: string[]) => {
    setProvinces(normalizeProvinceFilterValues(next));
  }, []);
  const handleCategoryChange = useCallback((next: string[]) => {
    setCategories(normalizeCategoryFilterValues(next));
  }, []);
  const hydratedSavedFilterKeyRef = useRef<string>("");
  const isEditingSmartView = activeSavedFilterId !== null;
  const savedFilterQuery = api.search.getSavedFilter.useQuery(
    { id: activeSavedFilterId ?? 0 },
    {
      enabled: activeSavedFilterId !== null,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    const params = new URLSearchParams();

    if (appliedFilters.keyword.trim()) {
      params.set("keyword", appliedFilters.keyword.trim());
    }
    if (appliedFilters.provinces.length > 0) {
      appendMultiValueParams(params, "province", appliedFilters.provinces);
    }
    if (appliedFilters.categories.length > 0) {
      appendMultiValueParams(params, "category", appliedFilters.categories);
    }
    if (appliedFilters.budgetMin.trim()) {
      params.set("budgetMin", appliedFilters.budgetMin.trim());
    }
    if (appliedFilters.budgetMax.trim()) {
      params.set("budgetMax", appliedFilters.budgetMax.trim());
    }
    if (appliedFilters.publishedFrom) {
      params.set("publishedFrom", appliedFilters.publishedFrom);
    }
    if (appliedFilters.publishedTo) {
      params.set("publishedTo", appliedFilters.publishedTo);
    }
    if (appliedFilters.minMatchScore > 0) {
      params.set("minMatchScore", String(appliedFilters.minMatchScore));
    }

    if (activeSavedFilterId !== null) {
      params.set("savedFilterId", String(activeSavedFilterId));
    }
    params.set("page", String(page));
    params.set("limit", String(limit));

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [activeSavedFilterId, appliedFilters, limit, page, pathname, router]);

  // Sync state from URL when query params change externally (back/forward,
  // Smart View apply). The state→URL effect above handles the reverse direction.
  const lastParamsKeyRef = useRef<string>(searchParams.toString());
  useEffect(() => {
    const key = searchParams.toString();
    if (key === lastParamsKeyRef.current) return;
    lastParamsKeyRef.current = key;

    const next = readFiltersFromSearchParams(searchParams);

    setKeyword(next.keyword);
    setProvinces(next.provinces);
    setCategories(next.categories);
    setBudgetMin(next.budgetMin);
    setBudgetMax(next.budgetMax);
    setPublishedFrom(next.publishedFrom);
    setPublishedTo(next.publishedTo);
    setMinMatchScore(next.minMatchScore);
    setAppliedFilters(next);

    if (usesUnsupportedSourceSortParams(searchParams)) {
      setSortDowngraded(true);
    }

    setPage(parsePositiveInt(searchParams.get("page"), 1));
    setLimit(parsePositiveInt(searchParams.get("limit"), 20));
  }, [searchParams]);

  const parsedBudgetMin = useMemo(
    () => parseOptionalNumber(budgetMin),
    [budgetMin],
  );
  const parsedBudgetMax = useMemo(
    () => parseOptionalNumber(budgetMax),
    [budgetMax],
  );
  const parsedAppliedBudgetMin = useMemo(
    () => parseOptionalNumber(appliedFilters.budgetMin),
    [appliedFilters.budgetMin],
  );
  const parsedAppliedBudgetMax = useMemo(
    () => parseOptionalNumber(appliedFilters.budgetMax),
    [appliedFilters.budgetMax],
  );
  const parsedAppliedPublishedFrom = useMemo(
    () => parseOptionalDateFilter(appliedFilters.publishedFrom),
    [appliedFilters.publishedFrom],
  );
  const parsedAppliedPublishedTo = useMemo(
    () => parseOptionalDateFilter(appliedFilters.publishedTo),
    [appliedFilters.publishedTo],
  );
  const normalizedDraftPublishedFrom = useMemo(
    () => normalizeDateFilterValue(publishedFrom),
    [publishedFrom],
  );
  const normalizedDraftPublishedTo = useMemo(
    () => normalizeDateFilterValue(publishedTo),
    [publishedTo],
  );

  const queryInput = useMemo(
    () => ({
      keyword: appliedFilters.keyword,
      provinces: appliedFilters.provinces,
      categories: appliedFilters.categories,
      budgetMin: parsedAppliedBudgetMin,
      budgetMax: parsedAppliedBudgetMax,
      publishedFrom: parsedAppliedPublishedFrom,
      publishedTo: parsedAppliedPublishedTo,
      minMatchScore: appliedFilters.minMatchScore,
      sortBy,
      sortOrder,
      offset: (page - 1) * limit,
      limit,
    }),
    [
      appliedFilters,
      limit,
      page,
      parsedAppliedBudgetMax,
      parsedAppliedBudgetMin,
      parsedAppliedPublishedFrom,
      parsedAppliedPublishedTo,
      sortBy,
      sortOrder,
    ],
  );

  const [packagesResult, packagesQuery] =
    api.search.queryPackages.useSuspenseQuery(queryInput);
  const packages = packagesResult.items;
  const total = packagesResult.total;
  const liveOptions = packagesResult.options;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const keywordOptions = useMemo(
    () => mergeSelectOptions(KEYWORD_OPTIONS, liveOptions.keywords),
    [liveOptions.keywords],
  );
  const localRefinementSummary = packagesResult.localRefinement.fields
    .map((field) => LOCAL_REFINEMENT_LABELS[field])
    .join(", ");
  const keywordTerms = useMemo(
    () =>
      keyword
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean),
    [keyword],
  );
  const provinceOptions = useMemo(
    () =>
      mergeSelectOptions(PROVINCE_OPTIONS, liveOptions.provinces, provinces),
    [liveOptions.provinces, provinces],
  );
  const categoryOptions = useMemo(
    () =>
      mergeSelectOptions(CATEGORY_OPTIONS, liveOptions.categories, categories),
    [categories, liveOptions.categories],
  );

  const utils = api.useUtils();

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const saveFilter = api.search.saveFilter.useMutation({
    onSuccess: async (savedFilter) => {
      setSaveError(null);
      setSmartViewSuccess(`Đã lưu Smart View "${savedFilter.name}".`);
      setSmartViewName("");
      await utils.search.listSavedFilters.invalidate();
    },
    onError: (error) => {
      setSmartViewSuccess(null);
      setSaveError(error.message || "Không thể lưu bộ lọc.");
    },
  });
  const updateSavedFilter = api.search.updateSavedFilter.useMutation({
    onSuccess: async (savedFilter) => {
      setSaveError(null);
      setSmartViewSuccess(`Đã cập nhật Smart View "${savedFilter.name}".`);
      setSmartViewName(savedFilter.name);
      setSmartViewFrequency(savedFilter.notificationFrequency);
      hydratedSavedFilterKeyRef.current = `${savedFilter.id}:${savedFilter.updatedAt}`;
      await Promise.all([
        utils.search.listSavedFilters.invalidate(),
        utils.search.getSavedFilter.invalidate({ id: savedFilter.id }),
      ]);
    },
    onError: (error) => {
      setSmartViewSuccess(null);
      setSaveError(error.message || "Không thể cập nhật Smart View.");
    },
  });

  const addWatchlist = api.watchlist.addItem.useMutation({
    onSuccess: async () => {
      await utils.watchlist.listItems.invalidate();
    },
  });

  const saveSelectedPackages = api.search.saveSelectedPackages.useMutation({
    onSuccess: async (result) => {
      setSaveSelectedError(null);
      setSaveSelectedSuccess(
        `Đã lưu ${result.savedCount} gói thầu, bỏ qua ${result.skippedCount} gói trùng.`,
      );
      setSelectedExternalIds(new Set<string>());
      await utils.insight.getDashboardSummary.invalidate();
    },
    onError: (error) => {
      setSaveSelectedSuccess(null);
      setSaveSelectedError(error.message || "Không thể lưu gói thầu đã chọn.");
    },
  });

  const budgetRangeError =
    typeof parsedBudgetMin === "number" &&
    typeof parsedBudgetMax === "number" &&
    parsedBudgetMin > parsedBudgetMax;

  const publishedDateRangeError =
    Boolean(normalizedDraftPublishedFrom) &&
    Boolean(normalizedDraftPublishedTo) &&
    normalizedDraftPublishedFrom > normalizedDraftPublishedTo;

  const draftFilters = useMemo<FilterState>(
    () => ({
      keyword,
      provinces,
      categories,
      budgetMin,
      budgetMax,
      publishedFrom,
      publishedTo,
      minMatchScore,
    }),
    [
      budgetMax,
      budgetMin,
      categories,
      keyword,
      minMatchScore,
      provinces,
      publishedFrom,
      publishedTo,
    ],
  );

  const hasPendingSearchFilterChanges = !areSameSearchFilters(
    draftFilters,
    appliedFilters,
  );
  const hasPendingPersistableFilterChanges = !areSamePersistableFilters(
    draftFilters,
    appliedFilters,
  );

  const budgetNegativeError =
    (typeof parsedBudgetMin === "number" && parsedBudgetMin < 0) ||
    (typeof parsedBudgetMax === "number" && parsedBudgetMax < 0);

  const applyDraftFilters = () => {
    if (budgetRangeError || budgetNegativeError || publishedDateRangeError) {
      return;
    }

    const nextFilters = normalizeFilterState({
      keyword,
      provinces,
      categories,
      budgetMin,
      budgetMax,
      publishedFrom,
      publishedTo,
      minMatchScore,
    });

    setAppliedAndDraftFilters(nextFilters);
  };

  const setAppliedAndDraftFilters = useCallback(
    (next: FilterState) => {
      const normalizedNext = normalizeFilterState(next);

      setKeyword(normalizedNext.keyword);
      setProvinces(normalizedNext.provinces);
      setCategories(normalizedNext.categories);
      setBudgetMin(normalizedNext.budgetMin);
      setBudgetMax(normalizedNext.budgetMax);
      setPublishedFrom(normalizedNext.publishedFrom);
      setPublishedTo(normalizedNext.publishedTo);
      setMinMatchScore(normalizedNext.minMatchScore);
      setAppliedFilters(normalizedNext);
      if (hasExactFilterChanges(appliedFilters, normalizedNext)) {
        setPage(1);
      }
      setSaveError(null);
      setSmartViewSuccess(null);
      setSaveSelectedSuccess(null);
      setSaveSelectedError(null);
    },
    [appliedFilters],
  );

  useEffect(() => {
    if (activeSavedFilterId === null) {
      hydratedSavedFilterKeyRef.current = "";
      setSmartViewName("");
      setSmartViewFrequency("daily");
      setSaveError(null);
      setSmartViewSuccess(null);
      return;
    }

    hydratedSavedFilterKeyRef.current = "";
    setSmartViewName("");
    setSmartViewFrequency("daily");
    setSaveError(null);
    setSmartViewSuccess(null);
  }, [activeSavedFilterId]);

  useEffect(() => {
    if (activeSavedFilterId === null || !savedFilterQuery.data) {
      return;
    }

    const hydratedKey = `${savedFilterQuery.data.id}:${savedFilterQuery.data.updatedAt}`;
    if (hydratedSavedFilterKeyRef.current === hydratedKey) {
      return;
    }

    hydratedSavedFilterKeyRef.current = hydratedKey;
    setSmartViewName(savedFilterQuery.data.name);
    setSmartViewFrequency(savedFilterQuery.data.notificationFrequency);
    setAppliedAndDraftFilters(
      buildFilterStateFromSavedFilter(savedFilterQuery.data),
    );
    setPage(1);
  }, [activeSavedFilterId, savedFilterQuery.data, setAppliedAndDraftFilters]);

  const appliedSmartViewPayload = useMemo(
    () => ({
      keyword: appliedFilters.keyword,
      provinces: appliedFilters.provinces,
      categories: appliedFilters.categories,
      budgetMin: parsedAppliedBudgetMin,
      budgetMax: parsedAppliedBudgetMax,
      minMatchScore: appliedFilters.minMatchScore,
    }),
    [
      appliedFilters.categories,
      appliedFilters.keyword,
      appliedFilters.minMatchScore,
      appliedFilters.provinces,
      parsedAppliedBudgetMax,
      parsedAppliedBudgetMin,
    ],
  );
  const isLoadingSmartView = isEditingSmartView && savedFilterQuery.isPending;
  const smartViewLoadError = isEditingSmartView
    ? savedFilterQuery.error?.message ?? null
    : null;
  const isSavingSmartView =
    saveFilter.isPending || updateSavedFilter.isPending;
  const canPersistSmartView =
    !budgetRangeError &&
    !budgetNegativeError &&
    !hasPendingPersistableFilterChanges &&
    !isLoadingSmartView &&
    !isSavingSmartView &&
    (!isEditingSmartView || Boolean(savedFilterQuery.data));

  const cancelSmartViewEditing = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("savedFilterId");
    const query = params.toString();

    setSaveError(null);
    setSmartViewSuccess(null);
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  const persistSmartView = () => {
    if (!canPersistSmartView) {
      return;
    }

    setSaveError(null);
    setSmartViewSuccess(null);

    const fallbackName =
      isEditingSmartView && savedFilterQuery.data
        ? savedFilterQuery.data.name
        : `Smart View ${new Date().toLocaleTimeString("vi-VN")}`;
    const payload = {
      name: smartViewName.trim() || fallbackName,
      ...appliedSmartViewPayload,
      notificationFrequency: smartViewFrequency,
    };

    if (isEditingSmartView && activeSavedFilterId !== null) {
      updateSavedFilter.mutate({
        id: activeSavedFilterId,
        ...payload,
      });
      return;
    }

    saveFilter.mutate(payload);
  };

  const appliedFilterChips = useMemo<AppliedFilterChip[]>(() => {
    const chips: AppliedFilterChip[] = [];

    if (appliedFilters.keyword.trim()) {
      chips.push({
        id: "keyword",
        label: `Từ khóa: ${appliedFilters.keyword.trim()}`,
      });
    }

    if (appliedFilters.provinces.length > 0) {
      chips.push({
        id: "provinces",
        label: `Tỉnh/Thành: ${appliedFilters.provinces.length} mục`,
      });
    }

    if (appliedFilters.categories.length > 0) {
      chips.push({
        id: "categories",
        label: `Lĩnh vực: ${appliedFilters.categories.length} mục`,
      });
    }

    const appliedMin = parseOptionalNumber(appliedFilters.budgetMin);
    const appliedMax = parseOptionalNumber(appliedFilters.budgetMax);
    if (typeof appliedMin === "number" || typeof appliedMax === "number") {
      chips.push({
        id: "budget",
        label: `Ngân sách: ${
          typeof appliedMin === "number"
            ? appliedMin.toLocaleString("vi-VN")
            : "0"
        } - ${
          typeof appliedMax === "number"
            ? appliedMax.toLocaleString("vi-VN")
            : "không giới hạn"
        }`,
      });
    }

    if (appliedFilters.publishedFrom || appliedFilters.publishedTo) {
      chips.push({
        id: "publishedAt",
        label: `Ngày đăng: ${
          appliedFilters.publishedFrom
            ? formatDateFilterValue(appliedFilters.publishedFrom)
            : "không giới hạn"
        } - ${
          appliedFilters.publishedTo
            ? formatDateFilterValue(appliedFilters.publishedTo)
            : "không giới hạn"
        }`,
      });
    }

    if (appliedFilters.minMatchScore > 0) {
      chips.push({
        id: "minMatchScore",
        label: `Match tối thiểu: ${appliedFilters.minMatchScore}%`,
      });
    }

    return chips;
  }, [appliedFilters]);

  const removeAppliedFilterChip = (chipId: AppliedFilterChipId) => {
    const next: FilterState = {
      ...appliedFilters,
      provinces: [...appliedFilters.provinces],
      categories: [...appliedFilters.categories],
    };

    if (chipId === "keyword") {
      next.keyword = "";
    }

    if (chipId === "provinces") {
      next.provinces = [];
    }

    if (chipId === "categories") {
      next.categories = [];
    }

    if (chipId === "budget") {
      next.budgetMin = "";
      next.budgetMax = "";
    }

    if (chipId === "publishedAt") {
      next.publishedFrom = "";
      next.publishedTo = "";
    }

    if (chipId === "minMatchScore") {
      next.minMatchScore = 0;
    }

    setAppliedAndDraftFilters(next);
  };

  const handleApplyOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    applyDraftFilters();
  };

  const allCurrentPageSelected =
    packages.length > 0 &&
    packages.every((item) => selectedExternalIds.has(item.externalId));

  const selectedItems = packages.filter((item) =>
    selectedExternalIds.has(item.externalId),
  );

  useEffect(() => {
    setSelectedExternalIds((prev) => {
      const visible = new Set(packages.map((item) => item.externalId));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [packages]);

  type SearchRow = (typeof packages)[number];

  const columns = useMemo<ColumnDef<SearchRow>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            checked={allCurrentPageSelected}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedExternalIds(
                  new Set<string>(packages.map((item) => item.externalId)),
                );
                return;
              }
              setSelectedExternalIds(new Set<string>());
            }}
            aria-label="Chọn tất cả gói thầu trang hiện tại"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedExternalIds.has(row.original.externalId)}
            onChange={(e) => {
              setSelectedExternalIds((prev) => {
                const next = new Set(prev);
                if (e.target.checked) {
                  next.add(row.original.externalId);
                } else {
                  next.delete(row.original.externalId);
                }
                return next;
              });
            }}
            aria-label={`Chọn gói thầu ${row.original.title}`}
          />
        ),
        size: 44,
      },
      {
        accessorKey: "title",
        header: () => <span className="font-semibold">Tên</span>,
        cell: ({ row }) => (
          <p className="max-w-[320px] min-w-[240px] leading-tight font-semibold [overflow-wrap:anywhere] text-slate-900">
            {row.original.title}
          </p>
        ),
      },
      {
        accessorKey: "inviter",
        header: () => <span className="font-semibold">Bên mời</span>,
        cell: ({ row }) => (
          <p className="max-w-[240px] text-xs [overflow-wrap:anywhere]">
            {row.original.inviter}
          </p>
        ),
      },
      {
        accessorKey: "province",
        header: "Tỉnh",
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap">
            {row.original.province}
          </span>
        ),
      },
      {
        accessorKey: "category",
        header: "Lĩnh vực",
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap">
            {row.original.category}
          </span>
        ),
      },
      {
        accessorKey: "budget",
        header: () => (
          <span className="block w-full text-right font-semibold">
            Ngân sách
          </span>
        ),
        cell: ({ row }) => (
          <p className="text-right font-mono font-semibold whitespace-nowrap">
            {formatCurrency(row.original.budget)}
          </p>
        ),
      },
      {
        accessorKey: "publishedAt",
        header: () => <span className="font-semibold">Ngày đăng ↓</span>,
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap">
            {formatDate(row.original.publishedAt)}
          </span>
        ),
      },
      {
        accessorKey: "matchScore",
        header: () => (
          <span className="block w-full text-right font-semibold">Match</span>
        ),
        cell: ({ row }) => (
          <p
            className={`text-right text-sm font-bold whitespace-nowrap ${
              row.original.matchScore >= 85
                ? "text-emerald-700"
                : row.original.matchScore >= 70
                  ? "text-blue-700"
                  : "text-slate-500"
            }`}
          >
            {row.original.matchScore}%
          </p>
        ),
      },
      {
        id: "status",
        header: "Ưu tiên",
        cell: ({ row }) => {
          const statusBadges = getImportantStatuses(row.original);
          return (
            <div className="flex max-w-[220px] min-w-[180px] flex-wrap gap-1">
              {statusBadges.length === 0 ? (
                <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  Bình thường
                </span>
              ) : (
                statusBadges.map((badge) => (
                  <span
                    key={`${row.original.externalId}-${badge.label}`}
                    className={`rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                ))
              )}
            </div>
          );
        },
      },
      {
        id: "action",
        header: "Hành động",
        cell: ({ row }) => (
          <div className="flex min-w-[180px] flex-wrap gap-1">
            <Link
              href={`/package-details/${encodeURIComponent(row.original.externalId)}?sourceUrl=${encodeURIComponent(row.original.sourceUrl)}`}
              className="inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
            >
              Chi tiết
            </Link>
            <a
              href={row.original.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
            >
              Nguồn
            </a>
            <Button
              variant="secondary"
              size="sm"
              className="px-1.5 py-1"
              onClick={() => {
                addWatchlist.mutate({
                  type: "package",
                  refKey: row.original.externalId,
                  label: row.original.title,
                });
              }}
            >
              Theo dõi
            </Button>
          </div>
        ),
      },
    ],
    [
      addWatchlist,
      allCurrentPageSelected,
      packages,
      selectedExternalIds,
    ],
  );

  const table = useReactTable({
    data: packages,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Kho dữ liệu gói thầu realtime</h2>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <p className="text-sm whitespace-nowrap text-slate-600">
            Tổng nguồn: {total.toLocaleString("vi-VN")} • Hiển thị trang này:{" "}
            {packagesResult.visibleCount}
            {packagesResult.localRefinement?.active ? `/${limit}` : ""}
          </p>
          <button
            type="button"
            onClick={() => packagesQuery.refetch()}
            disabled={packagesQuery.isFetching}
            aria-label="Tải lại kết quả tìm kiếm"
            title="Tải lại kết quả tìm kiếm"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 ${packagesQuery.isFetching ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            {packagesQuery.isFetching ? "Đang tải..." : "Tải lại"}
          </button>
          <Link
            href="/saved-items"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Mở Smart Views & Watchlist
          </Link>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Nguồn: BidWinner public ({packagesResult.source}) • Cập nhật:{" "}
        {formatDateTime(packagesResult.fetchedAt)}
      </p>
      {packagesResult.warning ? (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {packagesResult.warning}
        </div>
      ) : null}

      {packagesResult.localRefinement?.active ? (
        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Bạn đang tinh lọc trong trang nguồn hiện tại ({localRefinementSummary}
          ). Có thể còn kết quả khớp ở các trang nguồn khác — chỉ tỉnh/thành và
          phân trang được tìm trực tiếp trên BidWinner.
        </div>
      ) : null}

      {sortDowngraded ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Tham số sắp xếp cũ hoặc `sortOrder=asc` đã được hạ về chế độ nguồn hỗ
          trợ: ngày đăng mới nhất trước.
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500 uppercase">
            Bộ lọc đang áp dụng ({appliedFilterChips.length})
          </p>
          {appliedFilterChips.length > 0 ? (
            <button
              type="button"
              className="text-xs font-medium text-slate-600 hover:text-slate-900"
              onClick={() => {
                setAppliedAndDraftFilters({
                  keyword: "",
                  provinces: [],
                  categories: [],
                  budgetMin: "",
                  budgetMax: "",
                  publishedFrom: "",
                  publishedTo: "",
                  minMatchScore: 0,
                });
              }}
            >
              Xóa tất cả
            </button>
          ) : null}
        </div>

        {appliedFilterChips.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Chưa có điều kiện lọc nào đang được áp dụng.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {appliedFilterChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                onClick={() => removeAppliedFilterChip(chip.id)}
                title="Bấm để bỏ điều kiện này"
              >
                {chip.label} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FilterField label="Từ khóa" htmlFor="filter-keyword">
          <input
            id="filter-keyword"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            value={keyword}
            placeholder="Từ khóa (có thể nhập nhiều cụm, ngăn cách bằng dấu phẩy)"
            onChange={(e) => {
              setKeyword(e.target.value);
            }}
            onKeyDown={handleApplyOnEnter}
          />
        </FilterField>
        <FilterField label="Tỉnh/Thành" htmlFor="filter-provinces">
          <MultiSelectDropdown
            id="filter-provinces"
            ariaLabel="Tỉnh/Thành"
            options={provinceOptions}
            selected={provinces}
            onChange={handleProvinceChange}
            emptyLabel="Tất cả tỉnh/thành"
          />
        </FilterField>
        <FilterField label="Lĩnh vực" htmlFor="filter-categories">
          <MultiSelectDropdown
            id="filter-categories"
            ariaLabel="Lĩnh vực"
            options={categoryOptions}
            selected={categories}
            onChange={handleCategoryChange}
            emptyLabel="Tất cả lĩnh vực"
          />
        </FilterField>
        <FilterField label="Điểm match tối thiểu" htmlFor="filter-min-match">
          <input
            id="filter-min-match"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder="0–100"
            type="number"
            min={0}
            max={100}
            step={5}
            value={minMatchScore}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              setMinMatchScore(
                Number.isNaN(next) ? 0 : Math.max(0, Math.min(100, next)),
              );
            }}
            onKeyDown={handleApplyOnEnter}
          />
        </FilterField>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Chọn tất cả ở Tỉnh/Thành hoặc Lĩnh vực sẽ được chuẩn hóa về không lọc
        cho trường đó để giữ kết quả nguồn chính xác.
      </p>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-700">
          Gợi ý từ khóa nhanh (bấm để thêm):
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {keywordOptions.slice(0, 20).map((item) => (
            <button
              key={item}
              type="button"
              className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setKeyword((prev) => {
                  const terms = prev
                    .split(",")
                    .map((term) => term.trim())
                    .filter(Boolean);

                  if (
                    terms.some(
                      (term) => term.toLowerCase() === item.toLowerCase(),
                    )
                  ) {
                    return prev;
                  }

                  return terms.length > 0
                    ? `${terms.join(", ")}, ${item}`
                    : item;
                });
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Dirty search: nhập nhiều cụm bằng dấu phẩy, hệ thống sẽ tìm nếu khớp
          ít nhất một cụm.
        </p>
        {keywordTerms.length > 0 ? (
          <p className="mt-2 text-xs text-slate-600">
            Đang áp dụng {keywordTerms.length} cụm từ khóa.
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <FilterField label="Ngân sách từ" htmlFor="filter-budget-min">
          <input
            id="filter-budget-min"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder="VNĐ"
            type="number"
            min={0}
            value={budgetMin}
            onChange={(e) => {
              setBudgetMin(e.target.value);
            }}
            onBlur={() => {
              const parsed = parseOptionalNumber(budgetMin);
              if (typeof parsed !== "number") {
                setBudgetMin("");
                return;
              }

              setBudgetMin(String(Math.max(0, Math.round(parsed))));
            }}
            onKeyDown={handleApplyOnEnter}
          />
        </FilterField>
        <FilterField label="Ngân sách đến" htmlFor="filter-budget-max">
          <input
            id="filter-budget-max"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder="VNĐ"
            type="number"
            min={0}
            value={budgetMax}
            onChange={(e) => {
              setBudgetMax(e.target.value);
            }}
            onBlur={() => {
              const parsed = parseOptionalNumber(budgetMax);
              if (typeof parsed !== "number") {
                setBudgetMax("");
                return;
              }

              setBudgetMax(String(Math.max(0, Math.round(parsed))));
            }}
            onKeyDown={handleApplyOnEnter}
          />
        </FilterField>
        <FilterField label="Ngày đăng từ" htmlFor="filter-published-from">
          <input
            id="filter-published-from"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            type="date"
            value={publishedFrom}
            onChange={(e) => {
              setPublishedFrom(normalizeDateFilterValue(e.target.value));
            }}
            onKeyDown={handleApplyOnEnter}
          />
        </FilterField>
        <FilterField label="Ngày đăng đến" htmlFor="filter-published-to">
          <input
            id="filter-published-to"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            type="date"
            value={publishedTo}
            onChange={(e) => {
              setPublishedTo(normalizeDateFilterValue(e.target.value));
            }}
            onKeyDown={handleApplyOnEnter}
          />
        </FilterField>
        <FilterField
          label="Thứ tự (theo ngày đăng)"
          htmlFor="filter-sort-order"
        >
          <select
            id="filter-sort-order"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            value={sortOrder}
            disabled
          >
            <option value="desc">Mới nhất trước</option>
          </select>
        </FilterField>
        <FilterField label="Số dòng/trang" htmlFor="filter-page-size">
          <select
            id="filter-page-size"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            value={limit}
            onChange={(e) => {
              setLimit(parsePositiveInt(e.target.value, 20));
              setPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} dòng
              </option>
            ))}
          </select>
        </FilterField>
      </div>

      {budgetNegativeError ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Ngân sách không được âm.
        </p>
      ) : null}

      {budgetRangeError ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Ngân sách đến phải lớn hơn hoặc bằng ngân sách từ.
        </p>
      ) : null}

      {publishedDateRangeError ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Ngày đăng đến phải lớn hơn hoặc bằng ngày đăng từ.
        </p>
      ) : null}

      {isEditingSmartView ? (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-sky-900">
                {isLoadingSmartView
                  ? "Đang tải Smart View để chỉnh sửa"
                  : smartViewLoadError
                    ? "Không mở được Smart View"
                    : "Đang chỉnh sửa Smart View"}
              </p>
              <p className="mt-1 text-xs text-sky-800">
                {isLoadingSmartView
                  ? "Đang nạp điều kiện đã lưu, tên và tần suất thông báo."
                  : smartViewLoadError ??
                    "Cập nhật sẽ chỉ thay đổi Smart View này. Workflow đã tạo trước đó vẫn giữ bộ lọc snapshot hiện tại."}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={cancelSmartViewEditing}>
              Hủy chỉnh sửa
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <FilterField label="Tên Smart View" htmlFor="smart-view-name">
          <input
            id="smart-view-name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder={
              isEditingSmartView
                ? "Để trống để giữ nguyên tên Smart View hiện tại"
                : "Để trống để tự sinh tên theo giờ hiện tại"
            }
            value={smartViewName}
            disabled={isLoadingSmartView}
            onChange={(e) => setSmartViewName(e.target.value)}
          />
        </FilterField>
        <FilterField label="Tần suất thông báo" htmlFor="smart-view-frequency">
          <select
            id="smart-view-frequency"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            value={smartViewFrequency}
            disabled={isLoadingSmartView}
            onChange={(e) =>
              setSmartViewFrequency(e.target.value as "daily" | "weekly")
            }
          >
            <option value="daily">Hằng ngày</option>
            <option value="weekly">Hằng tuần</option>
          </select>
        </FilterField>
      </div>

      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Ngày đăng chỉ tinh lọc trang kết quả hiện tại và sẽ không được lưu vào
        Smart View hoặc workflow.
      </p>

      {hasPendingPersistableFilterChanges ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Hãy bấm &quot;Áp dụng bộ lọc&quot; trước khi lưu Smart View để điều kiện
          lưu ra khớp đúng với kết quả đang hiển thị.
        </p>
      ) : null}

      {!hasPendingPersistableFilterChanges &&
      isEditingSmartView &&
      !smartViewLoadError ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Smart View đang chỉnh sửa sẽ lưu bộ lọc đã áp dụng và tần suất{" "}
          {smartViewFrequencyLabels[smartViewFrequency].toLowerCase()}.
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
        <Button
          variant="primary"
          className="w-full sm:w-auto"
          onClick={applyDraftFilters}
          disabled={
            budgetRangeError ||
            budgetNegativeError ||
            publishedDateRangeError ||
            !hasPendingSearchFilterChanges
          }
        >
          Áp dụng bộ lọc
        </Button>
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          isLoading={isSavingSmartView}
          disabled={!canPersistSmartView}
          onClick={persistSmartView}
        >
          {isEditingSmartView
            ? isSavingSmartView
              ? "Đang cập nhật..."
              : "Cập nhật Smart View"
            : isSavingSmartView
              ? "Đang lưu..."
              : "Lưu bộ lọc"}
        </Button>
        <Button
          variant="primary"
          className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
          isLoading={saveSelectedPackages.isPending}
          disabled={selectedItems.length === 0}
          onClick={() => {
            setSaveSelectedSuccess(null);
            setSaveSelectedError(null);
            saveSelectedPackages.mutate({
              items: selectedItems.map((item) => ({
                externalId: item.externalId,
                title: item.title,
                inviter: item.inviter,
                province: item.province,
                category: item.category,
                budget: item.budget,
                publishedAt: item.publishedAt,
                closingAt: item.closingAt,
                sourceUrl: item.sourceUrl,
                matchScore: item.matchScore,
              })),
            });
          }}
        >
          {saveSelectedPackages.isPending
            ? "Đang lưu các gói đã chọn..."
            : `Lưu ${selectedItems.length} gói đã chọn vào DB`}
        </Button>
        <Button
          variant="ghost"
          className="w-full border border-slate-300 sm:w-auto"
          onClick={() => {
            setAppliedAndDraftFilters({
              keyword: "",
              provinces: [],
              categories: [],
              budgetMin: "",
              budgetMax: "",
              publishedFrom: "",
              publishedTo: "",
              minMatchScore: 0,
            });
            setLimit(20);
            setPage(1);
            setSelectedExternalIds(new Set<string>());
            setSaveSelectedSuccess(null);
            setSaveSelectedError(null);
          }}
        >
          Đặt lại bộ lọc
        </Button>
      </div>

      {saveError ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {saveError}
        </p>
      ) : null}

      {smartViewSuccess ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {smartViewSuccess}
        </p>
      ) : null}

      {saveSelectedSuccess ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saveSelectedSuccess}
        </p>
      ) : null}

      {saveSelectedError ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {saveSelectedError}
        </p>
      ) : null}

      {packages.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="Không có gói thầu phù hợp"
          description="Hãy nới bộ lọc, đổi từ khóa hoặc thử tải lại dữ liệu realtime từ BidWinner."
          cta={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                onClick={() => packagesQuery.refetch()}
              >
                Thử lại
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setAppliedAndDraftFilters({
                    keyword: "",
                    provinces: [],
                    categories: [],
                    budgetMin: "",
                    budgetMax: "",
                    publishedFrom: "",
                    publishedTo: "",
                    minMatchScore: 0,
                  });
                  setLimit(20);
                  setPage(1);
                }}
              >
                Xóa bộ lọc
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mt-6 w-full max-w-full overflow-x-auto rounded-lg border border-slate-300 shadow-sm">
            <table className="w-full min-w-[1180px] divide-y divide-slate-200 text-xs">
              <thead className="sticky top-0 z-10 bg-slate-900 text-left text-xs font-bold tracking-widest text-white uppercase">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="px-2 py-2">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {table.getRowModel().rows.map((row) => {
                  const statusBadges = getImportantStatuses(row.original);
                  const hasCritical = statusBadges.some(
                    (badge) => badge.level === "critical",
                  );

                  return (
                    <tr
                      key={row.id}
                      className={`border-l-4 transition-colors ${
                        hasCritical
                          ? "border-l-rose-500 bg-rose-50/70 hover:bg-rose-100/50"
                          : "border-l-transparent hover:bg-slate-50"
                      }`}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-2 py-2 align-middle">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Trang {page} / {totalPages} • Đã chọn {selectedItems.length} gói
              thầu
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Trước
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() =>
                  setPage((prev) => Math.min(totalPages, prev + 1))
                }
              >
                Sau
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
