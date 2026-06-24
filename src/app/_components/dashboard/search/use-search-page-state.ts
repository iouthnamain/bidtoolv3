"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";

import { type SortOrder } from "~/constants/search-options";
import {
  buildSearchUrlParams,
  emptySearchCriteria,
  normalizeSearchCriteria,
  parseOptionalNumber,
  parsePositiveId,
  parsePositiveInt,
  readSearchCriteriaFromSearchParams,
  readSearchModeFromSearchParams,
  summarizeSearchCriteria,
  type SearchCriteria,
} from "~/lib/search-criteria";
import { type SearchMode } from "~/lib/search-modes";
import {
  getSearchPathForMode,
  readSearchModeFromPathname,
} from "~/lib/search-routes";
import { api } from "~/trpc/react";

import { selectedKey, type FormState, type SearchItem } from "./search-types";

function buildFormState(criteria: SearchCriteria): FormState {
  return {
    keyword: criteria.keyword,
    provinces: criteria.provinces,
    packageCategories: criteria.packageCategories,
    classifyIds: criteria.classifyIds,
    planFields: criteria.planFields,
    procurementMethods: criteria.procurementMethods,
    projectGroups: criteria.projectGroups,
    budgetMin: criteria.budgetMin !== null ? String(criteria.budgetMin) : "",
    budgetMax: criteria.budgetMax !== null ? String(criteria.budgetMax) : "",
    publishedFrom: criteria.publishedFrom,
    publishedTo: criteria.publishedTo,
    minMatchScore: criteria.minMatchScore,
  };
}

function buildCriteriaFromForm(formState: FormState): SearchCriteria {
  return normalizeSearchCriteria({
    keyword: formState.keyword,
    provinces: formState.provinces,
    packageCategories: formState.packageCategories,
    classifyIds: formState.classifyIds,
    planFields: formState.planFields,
    procurementMethods: formState.procurementMethods,
    projectGroups: formState.projectGroups,
    budgetMin: parseOptionalNumber(formState.budgetMin),
    budgetMax: parseOptionalNumber(formState.budgetMax),
    publishedFrom: formState.publishedFrom,
    publishedTo: formState.publishedTo,
    minMatchScore: formState.minMatchScore,
  });
}

function serializeCriteria(criteria: SearchCriteria) {
  return JSON.stringify(normalizeSearchCriteria(criteria));
}

function readSortOrderFromSearchParams(
  searchParams: ReadonlyURLSearchParams,
): SortOrder {
  return searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
}

export function useSearchPageState({ fixedMode }: { fixedMode?: SearchMode }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const pathMode = readSearchModeFromPathname(pathname);
  const resolvedMode =
    fixedMode ?? pathMode ?? readSearchModeFromSearchParams(searchParams);

  const initialCriteria = readSearchCriteriaFromSearchParams(searchParams);
  const initialSavedFilterId = parsePositiveId(
    searchParams.get("savedFilterId"),
  );
  const initialPage = parsePositiveInt(searchParams.get("page"), 1);
  const initialLimit = parsePositiveInt(searchParams.get("limit"), 20);
  const initialSortOrder = readSortOrderFromSearchParams(searchParams);

  const [mode, setMode] = useState<SearchMode>(resolvedMode);
  const [formState, setFormState] = useState<FormState>(
    buildFormState(initialCriteria),
  );
  const [appliedCriteria, setAppliedCriteria] =
    useState<SearchCriteria>(initialCriteria);
  const [page, setPage] = useState(initialPage);
  const [limit, setLimit] = useState(initialLimit);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialSortOrder);
  const [savedFilterId, setSavedFilterId] = useState<number | null>(
    initialSavedFilterId,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [smartViewSuccess, setSmartViewSuccess] = useState<string | null>(null);
  const [saveSelectedSuccess, setSaveSelectedSuccess] = useState<string | null>(
    null,
  );
  const [saveSelectedError, setSaveSelectedError] = useState<string | null>(
    null,
  );
  const [watchlistSuccess, setWatchlistSuccess] = useState<string | null>(null);
  const [smartViewName, setSmartViewName] = useState("");
  const [smartViewFrequency, setSmartViewFrequency] = useState<
    "daily" | "weekly"
  >("daily");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const hydratedSavedFilterKeyRef = useRef<string>("");
  const lastParamsKeyRef = useRef<string>(searchParams.toString());

  const draftCriteria = useMemo(
    () => buildCriteriaFromForm(formState),
    [formState],
  );

  const queryInput = useMemo(
    () => ({
      mode,
      keyword: appliedCriteria.keyword,
      provinces: appliedCriteria.provinces,
      packageCategories: appliedCriteria.packageCategories,
      classifyIds: appliedCriteria.classifyIds,
      planFields: appliedCriteria.planFields,
      procurementMethods: appliedCriteria.procurementMethods,
      projectGroups: appliedCriteria.projectGroups,
      budgetMin: appliedCriteria.budgetMin,
      budgetMax: appliedCriteria.budgetMax,
      publishedFrom: appliedCriteria.publishedFrom
        ? appliedCriteria.publishedFrom
        : undefined,
      publishedTo: appliedCriteria.publishedTo
        ? appliedCriteria.publishedTo
        : undefined,
      minMatchScore: appliedCriteria.minMatchScore,
      sortOrder,
      offset: (page - 1) * limit,
      limit,
    }),
    [appliedCriteria, limit, mode, page, sortOrder],
  );
  const currentSearchParamsKey = searchParams.toString();

  const resultQuery = api.search.querySearchResults.useQuery(queryInput, {
    placeholderData: (previousData) =>
      previousData?.mode === mode ? previousData : undefined,
  });
  const result = resultQuery.data;
  const items = result?.items ?? EMPTY_SEARCH_ITEMS;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / limit)) : 1;

  const draftCriteriaKey = useMemo(
    () => serializeCriteria(draftCriteria),
    [draftCriteria],
  );
  const appliedCriteriaKey = useMemo(
    () => serializeCriteria(appliedCriteria),
    [appliedCriteria],
  );
  const hasPendingSearchFilterChanges =
    mode !== resolvedMode || draftCriteriaKey !== appliedCriteriaKey;

  const budgetRangeError =
    draftCriteria.budgetMin !== null &&
    draftCriteria.budgetMax !== null &&
    draftCriteria.budgetMin > draftCriteria.budgetMax;
  const publishedDateRangeError =
    Boolean(draftCriteria.publishedFrom) &&
    Boolean(draftCriteria.publishedTo) &&
    draftCriteria.publishedFrom > draftCriteria.publishedTo;

  const utils = api.useUtils();

  const savedFilterQuery = api.search.getSavedFilter.useQuery(
    { id: savedFilterId ?? 0 },
    {
      enabled: savedFilterId !== null,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    if (result && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, result, totalPages]);

  useEffect(() => {
    const params = buildSearchUrlParams({
      mode,
      criteria: appliedCriteria,
      page,
      limit,
      sortOrder,
      savedFilterId,
    });

    const query = params.toString();
    if (query === currentSearchParamsKey) {
      lastParamsKeyRef.current = currentSearchParamsKey;
      return;
    }

    lastParamsKeyRef.current = query;
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [
    appliedCriteria,
    currentSearchParamsKey,
    limit,
    mode,
    page,
    pathname,
    router,
    savedFilterId,
    sortOrder,
  ]);

  useEffect(() => {
    const key = currentSearchParamsKey;
    if (key === lastParamsKeyRef.current) {
      return;
    }
    lastParamsKeyRef.current = key;

    const nextMode =
      readSearchModeFromPathname(pathname) ??
      readSearchModeFromSearchParams(searchParams);
    const nextCriteria = readSearchCriteriaFromSearchParams(searchParams);
    if (nextMode !== mode) {
      setSelectedKeys(new Set<string>());
    }
    setMode(nextMode);
    setFormState(buildFormState(nextCriteria));
    setAppliedCriteria(nextCriteria);
    setPage(parsePositiveInt(searchParams.get("page"), 1));
    setLimit(parsePositiveInt(searchParams.get("limit"), 20));
    setSortOrder(readSortOrderFromSearchParams(searchParams));
    setSavedFilterId(parsePositiveId(searchParams.get("savedFilterId")));
  }, [currentSearchParamsKey, mode, pathname, searchParams]);

  const saveFilter = api.search.saveFilter.useMutation({
    onSuccess: async (savedFilter) => {
      setSaveError(null);
      setSmartViewSuccess(`Đã lưu Smart View "${savedFilter.name}".`);
      setSmartViewName(savedFilter.name);
      setSavedFilterId(savedFilter.id);
      setSmartViewFrequency(savedFilter.notificationFrequency);
      await utils.search.listSavedFilters.invalidate();
    },
    onError: (error) => {
      setSmartViewSuccess(null);
      setSaveError(error.message ?? "Không thể lưu Smart View.");
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
      setSaveError(error.message ?? "Không thể cập nhật Smart View.");
    },
  });

  const addWatchlist = api.watchlist.addItem.useMutation({
    onSuccess: async (_item, variables) => {
      setWatchlistSuccess(`Đã thêm "${variables.label}" vào danh sách theo dõi.`);
      await utils.watchlist.listItems.invalidate();
    },
  });

  const saveSelectedResults = api.search.saveSelectedResults.useMutation({
    onSuccess: async (saveResult) => {
      setSaveSelectedError(null);
      setSaveSelectedSuccess(
        `Đã lưu ${saveResult.savedCount} mục, bỏ qua ${saveResult.skippedCount} mục trùng.`,
      );
      setSelectedKeys(new Set<string>());
    },
    onError: (error) => {
      setSaveSelectedSuccess(null);
      setSaveSelectedError(error.message ?? "Không thể lưu các mục đã chọn.");
    },
  });

  useEffect(() => {
    setSelectedKeys((previous) => {
      const visible = new Set(items.map((item) => selectedKey(item)));
      const next = new Set<string>();

      previous.forEach((value) => {
        if (visible.has(value)) {
          next.add(value);
        }
      });

      return next;
    });
  }, [items]);

  useEffect(() => {
    if (savedFilterId === null) {
      hydratedSavedFilterKeyRef.current = "";
      setSmartViewName("");
      setSmartViewFrequency("daily");
      setSaveError(null);
      setSmartViewSuccess(null);
      return;
    }

    if (!savedFilterQuery.data) {
      return;
    }

    const hydratedKey = `${savedFilterQuery.data.id}:${savedFilterQuery.data.updatedAt}`;
    if (hydratedSavedFilterKeyRef.current === hydratedKey) {
      return;
    }

    hydratedSavedFilterKeyRef.current = hydratedKey;
    const nextMode = savedFilterQuery.data.mode;
    if (nextMode !== mode) {
      setSelectedKeys(new Set<string>());
    }
    setMode(nextMode);
    setFormState(buildFormState(savedFilterQuery.data.criteria));
    setAppliedCriteria(savedFilterQuery.data.criteria);
    setSmartViewName(savedFilterQuery.data.name);
    setSmartViewFrequency(savedFilterQuery.data.notificationFrequency);
    setPage(1);
    const targetPath = getSearchPathForMode(nextMode);
    if (pathname !== targetPath) {
      router.replace(targetPath);
    }
  }, [mode, pathname, router, savedFilterId, savedFilterQuery.data]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(selectedKey(item))),
    [items, selectedKeys],
  );
  const appliedChips = summarizeSearchCriteria(mode, appliedCriteria);

  const persistSmartView = () => {
    if (
      budgetRangeError ||
      publishedDateRangeError ||
      hasPendingSearchFilterChanges
    ) {
      return;
    }

    const payload = {
      name:
        smartViewName.trim() ||
        `Smart View ${new Date().toLocaleTimeString("vi-VN")}`,
      mode,
      keyword: appliedCriteria.keyword,
      provinces: appliedCriteria.provinces,
      packageCategories: appliedCriteria.packageCategories,
      classifyIds: appliedCriteria.classifyIds,
      planFields: appliedCriteria.planFields,
      procurementMethods: appliedCriteria.procurementMethods,
      projectGroups: appliedCriteria.projectGroups,
      budgetMin: appliedCriteria.budgetMin,
      budgetMax: appliedCriteria.budgetMax,
      publishedFrom: appliedCriteria.publishedFrom
        ? appliedCriteria.publishedFrom
        : undefined,
      publishedTo: appliedCriteria.publishedTo
        ? appliedCriteria.publishedTo
        : undefined,
      minMatchScore: appliedCriteria.minMatchScore,
      notificationFrequency: smartViewFrequency,
    };

    if (savedFilterId !== null) {
      updateSavedFilter.mutate({
        id: savedFilterId,
        ...payload,
      });
      return;
    }

    saveFilter.mutate(payload);
  };

  const applyDraftFilters = () => {
    if (budgetRangeError || publishedDateRangeError) {
      return;
    }

    setAppliedCriteria(draftCriteria);
    setPage(1);
    setSaveError(null);
    setSmartViewSuccess(null);
    setSaveSelectedSuccess(null);
    setSaveSelectedError(null);
    setWatchlistSuccess(null);
  };

  const resetFilters = () => {
    setFormState(buildFormState(emptySearchCriteria));
    setAppliedCriteria({ ...emptySearchCriteria });
    setPage(1);
    setSavedFilterId(null);
    setSmartViewName("");
    setSmartViewFrequency("daily");
    setSaveError(null);
    setSmartViewSuccess(null);
    setSaveSelectedSuccess(null);
    setSaveSelectedError(null);
    setWatchlistSuccess(null);
    setSelectedKeys(new Set<string>());
  };

  const removeAppliedChip = (chip: string) => {
    const nextCriteria = { ...appliedCriteria };

    if (chip.startsWith("Chế độ:")) {
      setMode("package_keyword");
      setPage(1);
      setSelectedKeys(new Set<string>());
      return;
    }

    if (chip.startsWith("Từ khóa:")) {
      nextCriteria.keyword = "";
    } else if (chip.startsWith("Tỉnh:")) {
      nextCriteria.provinces = [];
    } else if (chip.startsWith("Lĩnh vực gói:")) {
      nextCriteria.packageCategories = [];
    } else if (chip.startsWith("Ngành nghề:")) {
      nextCriteria.classifyIds = [];
    } else if (chip.startsWith("Lĩnh vực KHLCNT:")) {
      nextCriteria.planFields = [];
    } else if (chip.startsWith("HTLCNT:")) {
      nextCriteria.procurementMethods = [];
    } else if (chip.startsWith("Nhóm dự án:")) {
      nextCriteria.projectGroups = [];
    } else if (chip.startsWith("Ngân sách:")) {
      nextCriteria.budgetMin = null;
      nextCriteria.budgetMax = null;
    } else if (chip.startsWith("Ngày:")) {
      nextCriteria.publishedFrom = "";
      nextCriteria.publishedTo = "";
    } else if (chip.startsWith("Match tối thiểu:")) {
      nextCriteria.minMatchScore = 0;
    } else {
      return;
    }

    const normalizedCriteria = normalizeSearchCriteria(nextCriteria);
    setFormState(buildFormState(normalizedCriteria));
    setAppliedCriteria(normalizedCriteria);
    setPage(1);
    setSaveError(null);
    setSmartViewSuccess(null);
    setSaveSelectedSuccess(null);
    setSaveSelectedError(null);
    setWatchlistSuccess(null);
  };

  return {
    mode,
    formState,
    setFormState,
    page,
    setPage,
    limit,
    setLimit,
    sortOrder,
    setSortOrder,
    savedFilterId,
    setSavedFilterId,
    saveError,
    smartViewSuccess,
    saveSelectedSuccess,
    saveSelectedError,
    watchlistSuccess,
    smartViewName,
    setSmartViewName,
    smartViewFrequency,
    setSmartViewFrequency,
    selectedKeys,
    setSelectedKeys,
    draftCriteria,
    resultQuery,
    result,
    items,
    totalPages,
    hasPendingSearchFilterChanges,
    budgetRangeError,
    publishedDateRangeError,
    savedFilterQuery,
    saveFilter,
    updateSavedFilter,
    addWatchlist,
    saveSelectedResults,
    selectedItems,
    appliedChips,
    removeAppliedChip,
    persistSmartView,
    applyDraftFilters,
    resetFilters,
    isEditingSmartView: savedFilterId !== null,
  };
}

const EMPTY_SEARCH_ITEMS: SearchItem[] = [];
