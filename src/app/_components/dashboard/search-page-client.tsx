"use client";

import Link from "next/link";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";

import { PAGE_SIZE_OPTIONS, type SortOrder } from "~/constants/search-options";
import {
  buildSearchUrlParams,
  emptySearchCriteria,
  normalizeSearchCriteria,
  normalizeStringList,
  parseOptionalNumber,
  parsePositiveId,
  parsePositiveInt,
  readSearchCriteriaFromSearchParams,
  readSearchModeFromSearchParams,
  summarizeSearchCriteria,
  type SearchCriteria,
} from "~/lib/search-criteria";
import {
  SEARCH_ENTITY_LABELS,
  SEARCH_MODE_DESCRIPTIONS,
  SEARCH_MODE_LABELS,
  type SearchMode,
} from "~/lib/search-modes";
import { Button, EmptyState, FilterField } from "~/app/_components/ui";
import { type RouterOutputs, api } from "~/trpc/react";

type SearchResult = RouterOutputs["search"]["querySearchResults"];
type SearchItem = SearchResult["items"][number];

type FormState = {
  keyword: string;
  provinces: string[];
  packageCategories: string[];
  classifyIds: number[];
  planFields: string[];
  procurementMethods: string[];
  projectGroups: string[];
  budgetMin: string;
  budgetMax: string;
  publishedFrom: string;
  publishedTo: string;
  minMatchScore: number;
};

const LOCAL_REFINEMENT_LABELS = {
  keyword: "từ khóa",
  provinces: "tỉnh/thành",
  packageCategories: "lĩnh vực gói",
  classifyIds: "ngành nghề",
  budget: "ngân sách",
  publishedAt: "ngày",
  minMatchScore: "match score",
  planFields: "lĩnh vực KHLCNT",
  procurementMethods: "HTLCNT",
  projectGroups: "nhóm dự án",
} as const;

const smartViewFrequencyLabels = {
  daily: "Hằng ngày",
  weekly: "Hằng tuần",
} as const;

function formatCurrency(value: number) {
  return `${Number(value).toLocaleString("vi-VN")} VNĐ`;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("vi-VN");
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("vi-VN");
}

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
        <span className="truncate">{summarizeSelected(selected, emptyLabel)}</span>
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
            onChange={(event) => setQuery(event.target.value)}
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

function detailHrefForItem(item: SearchItem) {
  if (item.entityType === "plan") {
    return `/plan-details/${encodeURIComponent(item.externalId)}?sourceUrl=${encodeURIComponent(item.sourceUrl)}`;
  }

  if (item.entityType === "project") {
    return `/project-details/${encodeURIComponent(item.externalId)}?sourceUrl=${encodeURIComponent(item.sourceUrl)}`;
  }

  return `/package-details/${encodeURIComponent(item.externalId)}?sourceUrl=${encodeURIComponent(item.sourceUrl)}`;
}

function entityLabelForItems(items: SearchItem[]) {
  const entityType = items[0]?.entityType ?? "package";
  return SEARCH_ENTITY_LABELS[entityType];
}

function selectedKey(item: SearchItem) {
  return `${item.entityType}:${item.externalId}`;
}

function toSavePayload(item: SearchItem) {
  if (item.entityType === "plan") {
    return {
      entityType: "plan" as const,
      externalId: item.externalId,
      title: item.title,
      owner: item.owner,
      province: item.province,
      field: item.field,
      procurementMethod: item.procurementMethod,
      budget: item.budget,
      publishedAt: item.publishedAt,
      timeline: item.timeline,
      sourceUrl: item.sourceUrl,
    };
  }

  if (item.entityType === "project") {
    return {
      entityType: "project" as const,
      externalId: item.externalId,
      title: item.title,
      owner: item.owner,
      province: item.province,
      projectGroup: item.projectGroup,
      budget: item.budget,
      publishedAt: item.publishedAt,
      approvedAt: item.approvedAt,
      relatedPlanCount: item.relatedPlanCount,
      sourceUrl: item.sourceUrl,
    };
  }

  return {
    entityType: "package" as const,
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
  };
}

function SourceMetaBanner({ result }: { result: SearchResult }) {
  const exactFields = result.sourceMeta.exactFields
    .map((field) => LOCAL_REFINEMENT_LABELS[field])
    .join(", ");
  const localFields = result.localRefinement.fields
    .map((field) => LOCAL_REFINEMENT_LABELS[field])
    .join(", ");

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <p>
          Nguồn public:{" "}
          <a
            href={result.sourceMeta.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-sky-700 hover:underline"
          >
            {result.sourceMeta.pageUrl}
          </a>
        </p>
        <p className="mt-1">
          Chính xác từ nguồn:{" "}
          {exactFields.length > 0 ? exactFields : "phân trang/tổng số cơ bản"}
        </p>
        <p className="mt-1">
          Tinh lọc trong app: {localFields.length > 0 ? localFields : "không có"}
        </p>
      </div>

      {result.sourceMeta.notices.map((notice) => (
        <div
          key={notice}
          className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
        >
          {notice}
        </div>
      ))}

      {result.warning ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {result.warning}
        </div>
      ) : null}
    </div>
  );
}

function ResultsTable(props: {
  items: SearchItem[];
  selectedKeys: Set<string>;
  setSelectedKeys: Dispatch<SetStateAction<Set<string>>>;
  addWatchlist: ReturnType<typeof api.watchlist.addItem.useMutation>;
}) {
  const allSelected =
    props.items.length > 0 &&
    props.items.every((item) => props.selectedKeys.has(selectedKey(item)));

  const toggleAll = (checked: boolean) => {
    props.setSelectedKeys(
      checked
        ? new Set(props.items.map((item) => selectedKey(item)))
        : new Set<string>(),
    );
  };

  const toggleOne = (item: SearchItem, checked: boolean) => {
    props.setSelectedKeys((previous) => {
      const next = new Set(previous);
      const key = selectedKey(item);

      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  };

  if (props.items.length === 0) {
    return null;
  }

  const entityType = props.items[0]?.entityType ?? "package";

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
          <tr>
            <th className="px-3 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
                aria-label="Chọn tất cả"
              />
            </th>
            <th className="px-3 py-3">Tên</th>
            <th className="px-3 py-3">
              {entityType === "package"
                ? "Bên mời / chủ đầu tư"
                : entityType === "plan"
                  ? "Chủ đầu tư"
                  : "Đơn vị"}
            </th>
            <th className="px-3 py-3">Tỉnh</th>
            <th className="px-3 py-3">
              {entityType === "plan"
                ? "Lĩnh vực / HTLCNT"
                : entityType === "project"
                  ? "Nhóm dự án"
                  : "Lĩnh vực"}
            </th>
            <th className="px-3 py-3 text-right">Ngân sách</th>
            <th className="px-3 py-3">Ngày</th>
            <th className="px-3 py-3">Hành động</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {props.items.map((item) => (
            <tr key={selectedKey(item)} className="align-top">
              <td className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={props.selectedKeys.has(selectedKey(item))}
                  onChange={(event) => toggleOne(item, event.target.checked)}
                  aria-label={`Chọn ${item.externalId}`}
                />
              </td>
              <td className="px-3 py-3">
                <div className="max-w-[340px]">
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  {item.entityType === "plan" ? (
                    <p className="mt-1 text-xs text-slate-500">{item.planName}</p>
                  ) : null}
                  {item.entityType === "project" &&
                  item.relatedPlans.length > 0 ? (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-slate-500">
                        KHLCNT liên quan: {item.relatedPlanCount}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {item.relatedPlans.slice(0, 2).map((plan) => (
                          <a
                            key={plan.externalId}
                            href={plan.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-100"
                          >
                            {plan.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-3 text-xs text-slate-700">
                {item.entityType === "package"
                  ? item.inviter
                  : item.owner}
              </td>
              <td className="px-3 py-3 text-xs text-slate-700">{item.province}</td>
              <td className="px-3 py-3 text-xs text-slate-700">
                {item.entityType === "plan" ? (
                  <div>
                    <p>{item.field}</p>
                    <p className="mt-1 text-slate-500">{item.procurementMethod}</p>
                  </div>
                ) : item.entityType === "project" ? (
                  item.projectGroup
                ) : (
                  item.category
                )}
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-slate-800">
                {formatCurrency(item.budget)}
              </td>
              <td className="px-3 py-3 text-xs text-slate-700">
                {item.entityType === "project" ? (
                  <div>
                    <p>Đăng: {formatDate(item.publishedAt)}</p>
                    <p className="mt-1 text-slate-500">
                      Duyệt: {formatDate(item.approvedAt)}
                    </p>
                  </div>
                ) : item.entityType === "plan" ? (
                  <div>
                    <p>Đăng: {formatDate(item.publishedAt)}</p>
                    <p className="mt-1 text-slate-500">
                      Tiến độ: {item.timeline ?? "-"}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p>Đăng: {formatDate(item.publishedAt)}</p>
                    <p className="mt-1 text-slate-500">
                      Match: {item.matchScore}%
                    </p>
                  </div>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="flex min-w-[180px] flex-wrap gap-1">
                  <Link
                    href={detailHrefForItem(item)}
                    className="inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
                  >
                    Chi tiết
                  </Link>
                  <a
                    href={item.sourceUrl}
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
                    onClick={() =>
                      props.addWatchlist.mutate({
                        type: item.entityType,
                        refKey: item.externalId,
                        label: item.title,
                      })
                    }
                  >
                    Theo dõi
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchPageClient() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const initialMode = readSearchModeFromSearchParams(searchParams);
  const initialCriteria = readSearchCriteriaFromSearchParams(searchParams);
  const initialSavedFilterId = parsePositiveId(searchParams.get("savedFilterId"));
  const initialPage = parsePositiveInt(searchParams.get("page"), 1);
  const initialLimit = parsePositiveInt(searchParams.get("limit"), 20);
  const initialSortOrder = readSortOrderFromSearchParams(searchParams);

  const [mode, setMode] = useState<SearchMode>(initialMode);
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

  const [result, resultQuery] =
    api.search.querySearchResults.useSuspenseQuery(queryInput);
  const items = result.items;
  const totalPages = Math.max(1, Math.ceil(result.total / limit));
  const entityLabel = entityLabelForItems(items);

  const draftCriteriaKey = useMemo(
    () => serializeCriteria(draftCriteria),
    [draftCriteria],
  );
  const appliedCriteriaKey = useMemo(
    () => serializeCriteria(appliedCriteria),
    [appliedCriteria],
  );
  const hasPendingSearchFilterChanges =
    mode !== readSearchModeFromSearchParams(searchParams) ||
    draftCriteriaKey !== appliedCriteriaKey;

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
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [appliedCriteria, limit, mode, page, pathname, router, savedFilterId, sortOrder]);

  useEffect(() => {
    const key = searchParams.toString();
    if (key === lastParamsKeyRef.current) {
      return;
    }
    lastParamsKeyRef.current = key;

    const nextMode = readSearchModeFromSearchParams(searchParams);
    const nextCriteria = readSearchCriteriaFromSearchParams(searchParams);
    setMode(nextMode);
    setFormState(buildFormState(nextCriteria));
    setAppliedCriteria(nextCriteria);
    setPage(parsePositiveInt(searchParams.get("page"), 1));
    setLimit(parsePositiveInt(searchParams.get("limit"), 20));
    setSortOrder(readSortOrderFromSearchParams(searchParams));
    setSavedFilterId(parsePositiveId(searchParams.get("savedFilterId")));
  }, [searchParams]);

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
    onSuccess: async () => {
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
      await utils.insight.getDashboardSummary.invalidate();
    },
    onError: (error) => {
      setSaveSelectedSuccess(null);
      setSaveSelectedError(
        error.message ?? "Không thể lưu các mục đã chọn.",
      );
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
    setMode(savedFilterQuery.data.mode);
    setFormState(buildFormState(savedFilterQuery.data.criteria));
    setAppliedCriteria(savedFilterQuery.data.criteria);
    setSmartViewName(savedFilterQuery.data.name);
    setSmartViewFrequency(savedFilterQuery.data.notificationFrequency);
    setPage(1);
  }, [savedFilterId, savedFilterQuery.data]);

  const selectedItems = items.filter((item) => selectedKeys.has(selectedKey(item)));
  const appliedChips = summarizeSearchCriteria(mode, appliedCriteria);

  const persistSmartView = () => {
    if (budgetRangeError || publishedDateRangeError) {
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
  };

  const resetFilters = () => {
    setFormState(buildFormState(emptySearchCriteria));
    setAppliedCriteria({ ...emptySearchCriteria });
    setPage(1);
    setSelectedKeys(new Set<string>());
  };

  const isEditingSmartView = savedFilterId !== null;

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Trung tâm tìm kiếm BidWinner public</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Một trang tìm kiếm cho đủ 5 chế độ: gói thầu, theo địa phương,
            ngành nghề & địa phương, KHLCNT và dự án đầu tư phát triển.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            isLoading={resultQuery.isFetching}
            onClick={() => resultQuery.refetch()}
          >
            Tải lại
          </Button>
          <Link
            href="/saved-items"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Smart Views & Watchlist
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {(Object.keys(SEARCH_MODE_LABELS) as SearchMode[]).map((tabMode) => {
          const isActive = mode === tabMode;

          return (
            <button
              key={tabMode}
              type="button"
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                isActive
                  ? "border-sky-400 bg-sky-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
              onClick={() => {
                setMode(tabMode);
                setSavedFilterId(null);
                if (!budgetRangeError && !publishedDateRangeError) {
                  setAppliedCriteria(draftCriteria);
                }
                setPage(1);
              }}
            >
              <p className="text-sm font-semibold text-slate-900">
                {SEARCH_MODE_LABELS[tabMode]}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {SEARCH_MODE_DESCRIPTIONS[tabMode]}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
            Bộ lọc đang áp dụng
          </p>
          <button
            type="button"
            className="rounded-md px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
            onClick={resetFilters}
          >
            Xóa tất cả
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {appliedChips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <FilterField label="Từ khóa" htmlFor="search-keyword">
          <input
            id="search-keyword"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={formState.keyword}
            onChange={(event) =>
              setFormState((previous) => ({
                ...previous,
                keyword: event.target.value,
              }))
            }
            placeholder="Nhập nhiều cụm, phân tách bằng dấu phẩy"
          />
        </FilterField>

        <FilterField label="Tỉnh / thành">
          {mode === "package_location" ? (
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={formState.provinces[0] ?? ""}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  provinces: event.target.value ? [event.target.value] : [],
                }))
              }
            >
              <option value="">Chọn một tỉnh/thành</option>
              {result.options.provinces.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
          ) : (
            <MultiSelectDropdown
              ariaLabel="Tỉnh / thành"
              options={result.options.provinces}
              selected={formState.provinces}
              onChange={(next) =>
                setFormState((previous) => ({
                  ...previous,
                  provinces: next,
                }))
              }
              emptyLabel="Tất cả tỉnh/thành"
            />
          )}
        </FilterField>

        {(mode === "package_keyword" || mode === "package_location") && (
          <FilterField label="Lĩnh vực gói">
            <MultiSelectDropdown
              ariaLabel="Lĩnh vực gói"
              options={result.options.packageCategories}
              selected={formState.packageCategories}
              onChange={(next) =>
                setFormState((previous) => ({
                  ...previous,
                  packageCategories: next,
                }))
              }
              emptyLabel="Tất cả lĩnh vực gói"
            />
          </FilterField>
        )}

        {mode === "package_area_location" && (
          <FilterField
            label="Ngành nghề & địa phương"
            helper="Chọn nhiều classify public của BidWinner. Tab này tinh lọc trên cửa sổ dữ liệu đã tải."
          >
            <select
              multiple
              className="min-h-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={formState.classifyIds.map(String)}
              onChange={(event) => {
                const next = Array.from(event.target.selectedOptions)
                  .map((option) => Number.parseInt(option.value, 10))
                  .filter((value) => Number.isInteger(value) && value > 0);

                setFormState((previous) => ({
                  ...previous,
                  classifyIds: next,
                }));
              }}
            >
              {result.options.classifies.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {`${"· ".repeat(entry.depth)}${entry.name}`}
                </option>
              ))}
            </select>
          </FilterField>
        )}

        {mode === "plan" && (
          <>
            <FilterField label="Lĩnh vực KHLCNT">
              <MultiSelectDropdown
                ariaLabel="Lĩnh vực KHLCNT"
                options={result.options.planFields}
                selected={formState.planFields}
                onChange={(next) =>
                  setFormState((previous) => ({
                    ...previous,
                    planFields: next,
                  }))
                }
                emptyLabel="Tất cả lĩnh vực KHLCNT"
              />
            </FilterField>
            <FilterField label="HTLCNT">
              <MultiSelectDropdown
                ariaLabel="HTLCNT"
                options={result.options.procurementMethods}
                selected={formState.procurementMethods}
                onChange={(next) =>
                  setFormState((previous) => ({
                    ...previous,
                    procurementMethods: next,
                  }))
                }
                emptyLabel="Tất cả HTLCNT"
              />
            </FilterField>
          </>
        )}

        {mode === "project" && (
          <FilterField label="Nhóm dự án">
            <MultiSelectDropdown
              ariaLabel="Nhóm dự án"
              options={result.options.projectGroups}
              selected={formState.projectGroups}
              onChange={(next) =>
                setFormState((previous) => ({
                  ...previous,
                  projectGroups: next,
                }))
              }
              emptyLabel="Tất cả nhóm dự án"
            />
          </FilterField>
        )}

        <FilterField label="Ngân sách từ" htmlFor="search-budget-min">
          <input
            id="search-budget-min"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            type="number"
            min={0}
            value={formState.budgetMin}
            onChange={(event) =>
              setFormState((previous) => ({
                ...previous,
                budgetMin: event.target.value,
              }))
            }
          />
        </FilterField>

        <FilterField label="Ngân sách đến" htmlFor="search-budget-max">
          <input
            id="search-budget-max"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            type="number"
            min={0}
            value={formState.budgetMax}
            onChange={(event) =>
              setFormState((previous) => ({
                ...previous,
                budgetMax: event.target.value,
              }))
            }
          />
        </FilterField>

        <FilterField label="Ngày từ" htmlFor="search-date-from">
          <input
            id="search-date-from"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            type="date"
            value={formState.publishedFrom}
            onChange={(event) =>
              setFormState((previous) => ({
                ...previous,
                publishedFrom: event.target.value,
              }))
            }
          />
        </FilterField>

        <FilterField label="Ngày đến" htmlFor="search-date-to">
          <input
            id="search-date-to"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            type="date"
            value={formState.publishedTo}
            onChange={(event) =>
              setFormState((previous) => ({
                ...previous,
                publishedTo: event.target.value,
              }))
            }
          />
        </FilterField>

        {(mode === "package_keyword" ||
          mode === "package_location" ||
          mode === "package_area_location") && (
          <FilterField label="Match tối thiểu" htmlFor="search-match">
            <input
              id="search-match"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              type="number"
              min={0}
              max={100}
              value={formState.minMatchScore}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  minMatchScore: Number.parseInt(event.target.value, 10) || 0,
                }))
              }
            />
          </FilterField>
        )}

        <FilterField label="Sắp xếp ngày đăng">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
            {(
              [
                { value: "desc", label: "Mới nhất" },
                { value: "asc", label: "Cũ nhất" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  sortOrder === option.value
                    ? "bg-sky-700 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
                onClick={() => setSortOrder(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </FilterField>
      </div>

      {budgetRangeError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Ngân sách đến phải lớn hơn hoặc bằng ngân sách từ.
        </div>
      ) : null}

      {publishedDateRangeError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Ngày đến phải lớn hơn hoặc bằng ngày từ.
        </div>
      ) : null}

      {isEditingSmartView ? (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-sky-900">
                {savedFilterQuery.isPending
                  ? "Đang tải Smart View để chỉnh sửa"
                  : savedFilterQuery.error
                    ? "Không mở được Smart View"
                    : "Đang chỉnh sửa Smart View"}
              </p>
              <p className="mt-1 text-xs text-sky-800">
                {savedFilterQuery.error?.message ??
                  "Cập nhật Smart View sẽ không sửa workflow đã tạo trước đó."}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSavedFilterId(null)}
            >
              Hủy chỉnh sửa
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <FilterField label="Tên Smart View" htmlFor="smart-view-name">
          <input
            id="smart-view-name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Đặt tên cho bộ lọc đã áp dụng"
            value={smartViewName}
            onChange={(event) => setSmartViewName(event.target.value)}
          />
        </FilterField>
        <FilterField label="Tần suất thông báo" htmlFor="smart-view-frequency">
          <select
            id="smart-view-frequency"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={smartViewFrequency}
            onChange={(event) =>
              setSmartViewFrequency(event.target.value as "daily" | "weekly")
            }
          >
            <option value="daily">Hằng ngày</option>
            <option value="weekly">Hằng tuần</option>
          </select>
        </FilterField>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={
            budgetRangeError || publishedDateRangeError || !hasPendingSearchFilterChanges
          }
          onClick={applyDraftFilters}
        >
          Áp dụng bộ lọc
        </Button>
        <Button
          variant="secondary"
          isLoading={saveFilter.isPending || updateSavedFilter.isPending}
          disabled={budgetRangeError || publishedDateRangeError}
          onClick={persistSmartView}
        >
          {isEditingSmartView ? "Cập nhật Smart View" : "Lưu Smart View"}
        </Button>
        <Button
          variant="primary"
          className="bg-emerald-600 hover:bg-emerald-700"
          isLoading={saveSelectedResults.isPending}
          disabled={selectedItems.length === 0}
          onClick={() =>
            saveSelectedResults.mutate({
              items: selectedItems.map((item) => toSavePayload(item)),
            })
          }
        >
          {`Lưu ${selectedItems.length} ${entityLabel.toLowerCase()} đã chọn`}
        </Button>
      </div>

      {saveError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {saveError}
        </div>
      ) : null}

      {smartViewSuccess ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {smartViewSuccess} • {smartViewFrequencyLabels[smartViewFrequency]}
        </div>
      ) : null}

      {saveSelectedSuccess ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saveSelectedSuccess}
        </div>
      ) : null}

      {saveSelectedError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {saveSelectedError}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Kết quả {SEARCH_MODE_LABELS[mode]}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Tổng nguồn: {result.total.toLocaleString("vi-VN")} • Hiển thị cửa sổ
            này: {result.visibleCount} • Cập nhật: {formatDateTime(result.fetchedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={limit}
            onChange={(event) => {
              setLimit(parsePositiveInt(event.target.value, 20));
              setPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} dòng
              </option>
            ))}
          </select>
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm">
            <button
              type="button"
              className="rounded px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            >
              Trước
            </button>
            <span className="text-xs text-slate-500">
              Trang {page}/{totalPages}
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() =>
                setPage((previous) => Math.min(totalPages, previous + 1))
              }
            >
              Sau
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <SourceMetaBanner result={result} />
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={`Không có ${entityLabel.toLowerCase()} phù hợp`}
          description="Hãy nới bộ lọc, đổi chế độ tìm kiếm hoặc thử tải lại nguồn public của BidWinner."
          cta={
            <Button variant="secondary" onClick={() => resultQuery.refetch()}>
              Tải lại dữ liệu
            </Button>
          }
        />
      ) : (
        <div className="mt-4">
          <ResultsTable
            items={items}
            selectedKeys={selectedKeys}
            setSelectedKeys={setSelectedKeys}
            addWatchlist={addWatchlist}
          />
        </div>
      )}
    </section>
  );
}
