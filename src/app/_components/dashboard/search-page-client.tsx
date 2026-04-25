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
  SORT_LABELS,
  type SortBy,
  type SortOrder,
} from "~/constants/search-options";
import { Button } from "~/app/_components/ui";
import { api } from "~/trpc/react";

type FilterState = {
  keyword: string;
  provinces: string[];
  categories: string[];
  budgetMin: string;
  budgetMax: string;
  minMatchScore: number;
};

type AppliedFilterChipId =
  | "keyword"
  | "provinces"
  | "categories"
  | "budget"
  | "minMatchScore";

type AppliedFilterChip = {
  id: AppliedFilterChipId;
  label: string;
};

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
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString("vi-VN");
}

function formatDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
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
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
};

function MultiSelectDropdown({
  label,
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
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      <button
        type="button"
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

  const initialFilters: FilterState = {
    keyword: searchParams.get("keyword") ?? "",
    provinces: parseMultiValueParam(searchParams, "province"),
    categories: parseMultiValueParam(searchParams, "category"),
    budgetMin: searchParams.get("budgetMin") ?? "",
    budgetMax: searchParams.get("budgetMax") ?? "",
    minMatchScore: parseMinMatch(searchParams.get("minMatchScore")),
  };

  const [keyword, setKeyword] = useState(initialFilters.keyword);
  const [provinces, setProvinces] = useState(initialFilters.provinces);
  const [categories, setCategories] = useState(initialFilters.categories);
  const [budgetMin, setBudgetMin] = useState(initialFilters.budgetMin);
  const [budgetMax, setBudgetMax] = useState(initialFilters.budgetMax);
  const [minMatchScore, setMinMatchScore] = useState(
    initialFilters.minMatchScore,
  );
  const [appliedFilters, setAppliedFilters] =
    useState<FilterState>(initialFilters);
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const value = searchParams.get("sortBy");
    if (
      value === "publishedAt" ||
      value === "budget" ||
      value === "matchScore" ||
      value === "title" ||
      value === "inviter"
    ) {
      return value;
    }
    return "publishedAt";
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const value = searchParams.get("sortOrder");
    return value === "asc" || value === "desc" ? value : "desc";
  });
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() =>
    parsePositiveInt(searchParams.get("limit"), 20),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSelectedMessage, setSaveSelectedMessage] = useState<string | null>(
    null,
  );
  const [selectedExternalIds, setSelectedExternalIds] = useState<Set<string>>(
    () => new Set<string>(),
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
    if (appliedFilters.minMatchScore > 0) {
      params.set("minMatchScore", String(appliedFilters.minMatchScore));
    }

    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    params.set("page", String(page));
    params.set("limit", String(limit));

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [appliedFilters, limit, page, pathname, router, sortBy, sortOrder]);

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

  const queryInput = useMemo(
    () => ({
      keyword: appliedFilters.keyword,
      provinces: appliedFilters.provinces,
      categories: appliedFilters.categories,
      budgetMin: parsedAppliedBudgetMin,
      budgetMax: parsedAppliedBudgetMax,
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
      sortBy,
      sortOrder,
    ],
  );

  const [packagesResult] =
    api.search.queryPackages.useSuspenseQuery(queryInput);
  const packages = packagesResult.items;
  const total = packagesResult.total;
  const liveOptions = packagesResult.options;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const keywordOptions = useMemo(
    () => mergeSelectOptions(KEYWORD_OPTIONS, liveOptions.keywords),
    [liveOptions.keywords],
  );
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
    onSuccess: async () => {
      setSaveError(null);
      await utils.search.listSavedFilters.invalidate();
    },
    onError: (error) => {
      setSaveError(error.message || "Không thể lưu bộ lọc.");
    },
  });

  const addWatchlist = api.watchlist.addItem.useMutation({
    onSuccess: async () => {
      await utils.watchlist.listItems.invalidate();
    },
  });

  const saveSelectedPackages = api.search.saveSelectedPackages.useMutation({
    onSuccess: async (result) => {
      setSaveSelectedMessage(
        `Đã lưu ${result.savedCount} gói thầu, bỏ qua ${result.skippedCount} gói trùng.`,
      );
      setSelectedExternalIds(new Set<string>());
      await utils.insight.getDashboardSummary.invalidate();
    },
    onError: (error) => {
      setSaveSelectedMessage(
        error.message || "Không thể lưu gói thầu đã chọn.",
      );
    },
  });

  const budgetRangeError =
    typeof parsedBudgetMin === "number" &&
    typeof parsedBudgetMax === "number" &&
    parsedBudgetMin > parsedBudgetMax;

  const hasPendingFilterChanges =
    keyword !== appliedFilters.keyword ||
    !areSameStringLists(provinces, appliedFilters.provinces) ||
    !areSameStringLists(categories, appliedFilters.categories) ||
    budgetMin !== appliedFilters.budgetMin ||
    budgetMax !== appliedFilters.budgetMax ||
    minMatchScore !== appliedFilters.minMatchScore;

  const budgetNegativeError =
    (typeof parsedBudgetMin === "number" && parsedBudgetMin < 0) ||
    (typeof parsedBudgetMax === "number" && parsedBudgetMax < 0);

  const applyDraftFilters = () => {
    if (budgetRangeError || budgetNegativeError) {
      return;
    }

    setAppliedFilters({
      keyword,
      provinces,
      categories,
      budgetMin,
      budgetMax,
      minMatchScore,
    });
    setPage(1);
    setSaveSelectedMessage(null);
  };

  const setAppliedAndDraftFilters = (next: FilterState) => {
    setKeyword(next.keyword);
    setProvinces(next.provinces);
    setCategories(next.categories);
    setBudgetMin(next.budgetMin);
    setBudgetMax(next.budgetMax);
    setMinMatchScore(next.minMatchScore);
    setAppliedFilters(next);
    setPage(1);
    setSaveSelectedMessage(null);
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

  const handleSortByHeader = useCallback(
    (field: SortBy) => {
      setPage(1);
      if (field === sortBy) {
        setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
        return;
      }

      setSortBy(field);
      setSortOrder("desc");
    },
    [sortBy],
  );

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
        header: () => (
          <button
            type="button"
            onClick={() => handleSortByHeader("title")}
            className="font-semibold"
          >
            Tên {sortBy === "title" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
          </button>
        ),
        cell: ({ row }) => (
          <p className="max-w-[320px] min-w-[240px] leading-tight font-semibold [overflow-wrap:anywhere] text-slate-900">
            {row.original.title}
          </p>
        ),
      },
      {
        accessorKey: "inviter",
        header: () => (
          <button
            type="button"
            onClick={() => handleSortByHeader("inviter")}
            className="font-semibold"
          >
            Bên mời{" "}
            {sortBy === "inviter" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
          </button>
        ),
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
          <button
            type="button"
            onClick={() => handleSortByHeader("budget")}
            className="w-full text-right font-semibold"
          >
            Ngân sách{" "}
            {sortBy === "budget" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
          </button>
        ),
        cell: ({ row }) => (
          <p className="text-right font-mono font-semibold whitespace-nowrap">
            {formatCurrency(row.original.budget)}
          </p>
        ),
      },
      {
        accessorKey: "publishedAt",
        header: () => (
          <button
            type="button"
            onClick={() => handleSortByHeader("publishedAt")}
            className="font-semibold"
          >
            Ngày đăng{" "}
            {sortBy === "publishedAt" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
          </button>
        ),
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap">
            {formatDate(row.original.publishedAt)}
          </span>
        ),
      },
      {
        accessorKey: "matchScore",
        header: () => (
          <button
            type="button"
            onClick={() => handleSortByHeader("matchScore")}
            className="w-full text-right font-semibold"
          >
            Match{" "}
            {sortBy === "matchScore" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
          </button>
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
      handleSortByHeader,
      packages,
      selectedExternalIds,
      sortBy,
      sortOrder,
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
            Hiển thị {packages.length} / {total.toLocaleString("vi-VN")} kết quả
          </p>
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
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={keyword}
          placeholder="Từ khóa (có thể nhập nhiều cụm, ngăn cách bằng dấu phẩy)"
          onChange={(e) => {
            setKeyword(e.target.value);
          }}
          onKeyDown={handleApplyOnEnter}
        />
        <MultiSelectDropdown
          label="Tỉnh/Thành"
          options={provinceOptions}
          selected={provinces}
          onChange={setProvinces}
          emptyLabel="Chọn tỉnh/thành"
        />
        <MultiSelectDropdown
          label="Lĩnh vực"
          options={categoryOptions}
          selected={categories}
          onChange={setCategories}
          emptyLabel="Chọn lĩnh vực"
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Điểm match tối thiểu (0-100)"
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
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Bộ lọc nhiều lựa chọn hỗ trợ tìm nhanh, chọn tất cả và bỏ chọn ngay
        trong danh sách.
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Ngân sách từ (VNĐ)"
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
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Ngân sách đến (VNĐ)"
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
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as SortBy);
            setPage(1);
          }}
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              Sắp xếp theo: {label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={sortOrder}
          onChange={(e) => {
            setSortOrder(e.target.value as SortOrder);
            setPage(1);
          }}
        >
          <option value="desc">Thứ tự giảm dần</option>
          <option value="asc">Thứ tự tăng dần</option>
        </select>
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={limit}
          onChange={(e) => {
            setLimit(parsePositiveInt(e.target.value, 20));
            setPage(1);
          }}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size} dòng/trang
            </option>
          ))}
        </select>
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

      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
        <Button
          variant="primary"
          className="w-full sm:w-auto"
          onClick={applyDraftFilters}
          disabled={
            budgetRangeError || budgetNegativeError || !hasPendingFilterChanges
          }
        >
          Áp dụng bộ lọc
        </Button>
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          isLoading={saveFilter.isPending}
          disabled={budgetRangeError || budgetNegativeError}
          onClick={() => {
            setSaveError(null);
            saveFilter.mutate({
              name: `Bộ lọc ${new Date().toLocaleTimeString("vi-VN")}`,
              keyword,
              provinces,
              categories,
              budgetMin: parsedBudgetMin,
              budgetMax: parsedBudgetMax,
              notificationFrequency: "daily",
            });
          }}
        >
          {saveFilter.isPending ? "Đang lưu..." : "Lưu bộ lọc"}
        </Button>
        <Button
          variant="primary"
          className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
          isLoading={saveSelectedPackages.isPending}
          disabled={selectedItems.length === 0}
          onClick={() => {
            setSaveSelectedMessage(null);
            saveSelectedPackages.mutate({
              items: selectedItems.map((item) => ({
                externalId: item.externalId,
                title: item.title,
                inviter: item.inviter,
                province: item.province,
                category: item.category,
                budget: item.budget,
                publishedAt: item.publishedAt,
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
              minMatchScore: 0,
            });
            setSortBy("publishedAt");
            setSortOrder("desc");
            setLimit(20);
            setPage(1);
            setSelectedExternalIds(new Set<string>());
            setSaveSelectedMessage(null);
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

      {saveSelectedMessage ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saveSelectedMessage}
        </p>
      ) : null}

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
            {packages.length === 0 ? (
              <tr>
                <td
                  className="px-2 py-6 text-center text-xs text-slate-500"
                  colSpan={10}
                >
                  Không tìm thấy gói thầu phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Trang {page} / {totalPages} • Đã chọn {selectedItems.length} gói thầu
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Trước
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Sau
          </button>
        </div>
      </div>
    </section>
  );
}
