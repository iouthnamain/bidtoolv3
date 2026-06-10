"use client";

import Link from "next/link";
import {
  type Dispatch,
  type KeyboardEvent,
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
import {
  BellPlus,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  RefreshCw,
  Save,
  SlidersHorizontal,
  X,
} from "lucide-react";

import {
  CATEGORY_OPTIONS,
  KEYWORD_OPTIONS,
  PAGE_SIZE_OPTIONS,
  PROVINCE_OPTIONS,
  type SortOrder,
} from "~/constants/search-options";
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
  getSearchEntityType,
  type SearchMode,
} from "~/lib/search-modes";
import {
  Button,
  EmptyState,
  FilterField,
  SkeletonTable,
} from "~/app/_components/ui";
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

const DEFAULT_RESULT_OPTIONS: SearchResult["options"] = {
  provinces: [...PROVINCE_OPTIONS],
  keywords: [...KEYWORD_OPTIONS],
  packageCategories: [...CATEGORY_OPTIONS],
  planFields: [],
  procurementMethods: [],
  projectGroups: [],
  classifies: [],
};

const EMPTY_SEARCH_ITEMS: SearchItem[] = [];

const DEFAULT_BUDGET_SLIDER_MAX = 100_000_000_000;
const BUDGET_SLIDER_STEP = 1_000_000;

const controlClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none";

const dateFormatter = new Intl.DateTimeFormat("vi-VN");
const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatCurrency(value: number) {
  return `${Number(value).toLocaleString("vi-VN")} VNĐ`;
}

function formatCompactCurrency(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("vi-VN", {
      maximumFractionDigits: 1,
    })} tỷ`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("vi-VN", {
      maximumFractionDigits: 0,
    })} triệu`;
  }

  return value.toLocaleString("vi-VN");
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

  return dateFormatter.format(parsed);
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

  return dateTimeFormatter.format(parsed);
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
  const selectedSet = useMemo(() => new Set(selected), [selected]);

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
    if (selectedSet.has(value)) {
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
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
          <input
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
            name="multiselect-search"
            aria-label="Tìm trong danh sách"
            autoComplete="off"
            placeholder="Tìm nhanh…"
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
                    checked={selectedSet.has(item)}
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

function ownerTextForItem(item: SearchItem) {
  return item.entityType === "package" ? item.inviter : item.owner;
}

function fieldTextForItem(item: SearchItem) {
  if (item.entityType === "plan") {
    return [item.field, item.procurementMethod].filter(Boolean).join(" / ");
  }

  if (item.entityType === "project") {
    return item.projectGroup;
  }

  return item.category;
}

function idHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "plan") {
    return "Mã KHLCNT";
  }

  if (entityType === "project") {
    return "Mã dự án";
  }

  return "Số TBMT";
}

function titleHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "plan") {
    return "Tên KHLCNT";
  }

  if (entityType === "project") {
    return "Tên dự án";
  }

  return "Tên gói thầu";
}

function deadlineHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "plan") {
    return "Tiến độ";
  }

  if (entityType === "project") {
    return "Phê duyệt";
  }

  return "Đóng thầu";
}

function budgetHeaderForEntity(entityType: SearchItem["entityType"]) {
  if (entityType === "project") {
    return "Tổng mức đầu tư";
  }

  return "Giá gói thầu";
}

function deadlineTextForItem(item: SearchItem) {
  if (item.entityType === "package") {
    return formatDate(item.closingAt);
  }

  if (item.entityType === "plan") {
    return item.timeline ?? "-";
  }

  return formatDate(item.approvedAt);
}

function entityLabelForMode(mode: SearchMode) {
  return SEARCH_ENTITY_LABELS[getSearchEntityType(mode)];
}

function selectedKey(item: SearchItem) {
  return `${item.entityType}:${item.externalId}`;
}

function ResultActions({
  item,
  addWatchlist,
}: {
  item: SearchItem;
  addWatchlist: ReturnType<typeof api.watchlist.addItem.useMutation>;
}) {
  return (
    <div className="flex min-w-[180px] flex-wrap gap-1.5">
      <Link
        href={detailHrefForItem(item)}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
        Chi tiết
      </Link>
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        Nguồn
      </a>
      <Button
        variant="secondary"
        size="sm"
        className="px-1.5 py-1"
        leftIcon={<BellPlus className="h-3.5 w-3.5" />}
        onClick={() =>
          addWatchlist.mutate({
            type: item.entityType,
            refKey: item.externalId,
            label: item.title,
          })
        }
      >
        Theo dõi
      </Button>
    </div>
  );
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
          Tinh lọc trong app:{" "}
          {localFields.length > 0 ? localFields : "không có"}
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

function ResultMatchSummary({ result }: { result: SearchResult }) {
  const entityLabel =
    SEARCH_ENTITY_LABELS[result.items[0]?.entityType ?? "package"];
  const count = result.visibleCount.toLocaleString("vi-VN");

  if ((result.items[0]?.entityType ?? "package") !== "package") {
    return (
      <div className="border-l-4 border-sky-400 bg-white px-4 py-3 text-sm font-medium text-sky-600">
        Tìm thấy{" "}
        <span className="text-emerald-600">
          {count} {entityLabel.toLowerCase()}
        </span>{" "}
        phù hợp với bộ lọc đang áp dụng.
      </div>
    );
  }

  return (
    <div className="border-l-4 border-sky-400 bg-white px-4 py-3 text-sm font-medium">
      <span className="text-sky-600">Tìm thấy </span>
      <span className="text-emerald-600">{count} gói thầu </span>
      <span className="text-emerald-600">chưa đóng thầu </span>
      <span className="text-sky-600">trong tên gói thầu | bên mời thầu </span>
      <span className="text-emerald-600">tại các tỉnh thành phố </span>
      <span className="text-sky-600">bạn lựa chọn</span>
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
    <div className="space-y-3">
      <div className="space-y-2 md:hidden">
        {props.items.map((item) => (
          <article
            key={selectedKey(item)}
            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={props.selectedKeys.has(selectedKey(item))}
                onChange={(event) => toggleOne(item, event.target.checked)}
                aria-label={`Chọn ${item.externalId}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-5 font-semibold [overflow-wrap:anywhere] text-slate-950">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.externalId} • {item.province}
                </p>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-slate-50 px-2 py-1.5">
                <dt className="text-slate-400">Đơn vị</dt>
                <dd className="mt-0.5 line-clamp-2 font-medium text-slate-700">
                  {ownerTextForItem(item)}
                </dd>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-1.5">
                <dt className="text-slate-400">Lĩnh vực</dt>
                <dd className="mt-0.5 line-clamp-2 font-medium text-slate-700">
                  {fieldTextForItem(item)}
                </dd>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-1.5">
                <dt className="text-slate-400">Ngân sách</dt>
                <dd className="mt-0.5 font-mono font-semibold text-slate-800">
                  {formatCurrency(item.budget)}
                </dd>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-1.5">
                <dt className="text-slate-400">Ngày đăng</dt>
                <dd className="mt-0.5 font-medium text-slate-700">
                  {formatDate(item.publishedAt)}
                </dd>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-1.5">
                <dt className="text-slate-400">
                  {deadlineHeaderForEntity(item.entityType)}
                </dt>
                <dd className="mt-0.5 font-medium text-slate-700">
                  {deadlineTextForItem(item)}
                </dd>
              </div>
            </dl>

            <div className="mt-3">
              <ResultActions item={item} addWatchlist={props.addWatchlist} />
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
        <table className="min-w-[1180px] divide-y divide-slate-200 bg-white text-sm">
          <thead className="bg-white text-left text-[13px] font-semibold text-slate-500">
            <tr>
              <th className="w-10 px-3 py-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                  aria-label="Chọn tất cả"
                />
              </th>
              <th className="w-32 px-3 py-4">
                {idHeaderForEntity(entityType)}
              </th>
              <th className="min-w-[300px] px-3 py-4">
                {titleHeaderForEntity(entityType)}
              </th>
              <th className="w-44 px-3 py-4">Địa điểm thực hiện</th>
              <th className="min-w-[220px] px-3 py-4">
                Bên mời thầu/Chủ đầu tư
              </th>
              <th className="w-32 px-3 py-4">
                {deadlineHeaderForEntity(entityType)}
              </th>
              <th className="w-36 px-3 py-4 text-right">
                {budgetHeaderForEntity(entityType)}
              </th>
              <th className="w-28 px-3 py-4">Đăng tải</th>
              <th className="w-44 px-3 py-4">Hành động</th>
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
                  <Link
                    href={detailHrefForItem(item)}
                    className="inline-block text-sm leading-5 font-medium [overflow-wrap:anywhere] text-[#0091ff] hover:underline"
                  >
                    {item.externalId}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    {item.entityType === "package" ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {item.category} • Match {item.matchScore}%
                      </p>
                    ) : null}
                    {item.entityType === "plan" ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {item.planName}
                      </p>
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
                  {item.province}
                </td>
                <td className="px-3 py-3 text-xs text-slate-700">
                  {ownerTextForItem(item)}
                </td>
                <td className="px-3 py-3 text-xs text-slate-700">
                  {deadlineTextForItem(item)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-slate-800">
                  {formatCurrency(item.budget)}
                </td>
                <td className="px-3 py-3 text-xs text-slate-700">
                  {formatDate(item.publishedAt)}
                </td>
                <td className="px-3 py-3">
                  <ResultActions
                    item={item}
                    addWatchlist={props.addWatchlist}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SearchPageClient() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const initialMode = readSearchModeFromSearchParams(searchParams);
  const initialCriteria = readSearchCriteriaFromSearchParams(searchParams);
  const initialSavedFilterId = parsePositiveId(
    searchParams.get("savedFilterId"),
  );
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
  const currentSearchParamsKey = searchParams.toString();

  const resultQuery = api.search.querySearchResults.useQuery(queryInput, {
    placeholderData: (previousData) =>
      previousData?.mode === mode ? previousData : undefined,
  });
  const result = resultQuery.data;
  const items = result?.items ?? EMPTY_SEARCH_ITEMS;
  const filterOptions = result?.options ?? DEFAULT_RESULT_OPTIONS;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / limit)) : 1;
  const entityLabel = entityLabelForMode(mode);
  const isInitialResultsLoading = resultQuery.isLoading && !result;
  const isShowingPreviousResults = Boolean(resultQuery.isPlaceholderData);
  const budgetMinNumber = parseOptionalNumber(formState.budgetMin) ?? 0;
  const budgetMaxNumber = parseOptionalNumber(formState.budgetMax);
  const budgetSliderMax = Math.max(
    DEFAULT_BUDGET_SLIDER_MAX,
    result?.windowBudgetRange.max ?? 0,
    budgetMinNumber,
    budgetMaxNumber ?? 0,
  );
  const budgetSliderMinValue = Math.min(budgetMinNumber, budgetSliderMax);
  const budgetSliderMaxValue =
    budgetMaxNumber !== null
      ? Math.min(
          Math.max(budgetMaxNumber, budgetSliderMinValue),
          budgetSliderMax,
        )
      : budgetSliderMax;
  const budgetSliderMinPercent =
    budgetSliderMax > 0 ? (budgetSliderMinValue / budgetSliderMax) * 100 : 0;
  const budgetSliderMaxPercent =
    budgetSliderMax > 0 ? (budgetSliderMaxValue / budgetSliderMax) * 100 : 100;

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

    const nextMode = readSearchModeFromSearchParams(searchParams);
    const nextCriteria = readSearchCriteriaFromSearchParams(searchParams);
    setMode(nextMode);
    setFormState(buildFormState(nextCriteria));
    setAppliedCriteria(nextCriteria);
    setPage(parsePositiveInt(searchParams.get("page"), 1));
    setLimit(parsePositiveInt(searchParams.get("limit"), 20));
    setSortOrder(readSortOrderFromSearchParams(searchParams));
    setSavedFilterId(parsePositiveId(searchParams.get("savedFilterId")));
  }, [currentSearchParamsKey, searchParams]);

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
    setMode(savedFilterQuery.data.mode);
    setFormState(buildFormState(savedFilterQuery.data.criteria));
    setAppliedCriteria(savedFilterQuery.data.criteria);
    setSmartViewName(savedFilterQuery.data.name);
    setSmartViewFrequency(savedFilterQuery.data.notificationFrequency);
    setPage(1);
  }, [savedFilterId, savedFilterQuery.data]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(selectedKey(item))),
    [items, selectedKeys],
  );
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

  const applyDraftFiltersOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    applyDraftFilters();
  };

  const resetFilters = () => {
    setFormState(buildFormState(emptySearchCriteria));
    setAppliedCriteria({ ...emptySearchCriteria });
    setPage(1);
    setSelectedKeys(new Set<string>());
  };

  const isEditingSmartView = savedFilterId !== null;

  return (
    <div className="space-y-4">
      <section id="search-modes" className="panel scroll-mt-6 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Trung tâm tìm kiếm BidWinner public
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Một trang tìm kiếm cho đủ 5 chế độ: gói thầu, theo địa phương,
              ngành nghề & địa phương, KHLCNT và dự án đầu tư phát triển.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/saved-items"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <BookmarkCheck className="h-3.5 w-3.5" aria-hidden />
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
                className={`rounded-lg border px-4 py-3 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
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

        <div
          id="search-filters"
          className="mt-4 scroll-mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
              Bộ lọc đang áp dụng
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
              onClick={resetFilters}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
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

        <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <FilterField label="Tên Smart View" htmlFor="smart-view-name">
            <input
              id="smart-view-name"
              className={controlClass}
              placeholder="Đặt tên cho bộ lọc đã áp dụng"
              value={smartViewName}
              onChange={(event) => setSmartViewName(event.target.value)}
            />
          </FilterField>
          <FilterField
            label="Tần suất thông báo"
            htmlFor="smart-view-frequency"
          >
            <select
              id="smart-view-frequency"
              className={controlClass}
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
              budgetRangeError ||
              publishedDateRangeError ||
              !hasPendingSearchFilterChanges
            }
            leftIcon={<SlidersHorizontal className="h-4 w-4" />}
            onClick={applyDraftFilters}
          >
            Áp dụng bộ lọc
          </Button>
          <Button
            variant="secondary"
            isLoading={saveFilter.isPending || updateSavedFilter.isPending}
            disabled={budgetRangeError || publishedDateRangeError}
            leftIcon={<BookmarkCheck className="h-4 w-4" />}
            onClick={persistSmartView}
          >
            {isEditingSmartView ? "Cập nhật Smart View" : "Lưu Smart View"}
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <FilterField label="Từ khóa" htmlFor="search-keyword">
            <input
              id="search-keyword"
              className={controlClass}
              value={formState.keyword}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  keyword: event.target.value,
                }))
              }
              onKeyDown={applyDraftFiltersOnEnter}
              placeholder="Nhập nhiều cụm, phân tách bằng dấu phẩy"
            />
          </FilterField>

          <FilterField label="Tỉnh / thành">
            {mode === "package_location" ? (
              <select
                className={controlClass}
                value={formState.provinces[0] ?? ""}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    provinces: event.target.value ? [event.target.value] : [],
                  }))
                }
              >
                <option value="">Chọn một tỉnh/thành</option>
                {filterOptions.provinces.map((province) => (
                  <option key={province} value={province}>
                    {province}
                  </option>
                ))}
              </select>
            ) : (
              <MultiSelectDropdown
                ariaLabel="Tỉnh / thành"
                options={filterOptions.provinces}
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
                options={filterOptions.packageCategories}
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
                className={`${controlClass} min-h-56`}
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
                {filterOptions.classifies.map((entry) => (
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
                  options={filterOptions.planFields}
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
                  options={filterOptions.procurementMethods}
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
                options={filterOptions.projectGroups}
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

          <FilterField
            label="Ngân sách"
            htmlFor="search-budget-min"
            className="lg:col-span-2"
          >
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  className="flex flex-col gap-1"
                  htmlFor="search-budget-min"
                >
                  <span className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                    Ngân sách từ
                  </span>
                  <input
                    id="search-budget-min"
                    className={controlClass}
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
                </label>

                <label
                  className="flex flex-col gap-1"
                  htmlFor="search-budget-max"
                >
                  <span className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                    Ngân sách đến
                  </span>
                  <input
                    id="search-budget-max"
                    className={controlClass}
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
                </label>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  <span>{formatCompactCurrency(budgetSliderMinValue)}</span>
                  <span>{formatCompactCurrency(budgetSliderMaxValue)}</span>
                </div>
                <div className="relative h-8">
                  <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-slate-200" />
                  <div
                    className="absolute top-3 h-2 rounded-full bg-sky-500"
                    style={{
                      left: `${budgetSliderMinPercent}%`,
                      right: `${100 - budgetSliderMaxPercent}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={budgetSliderMax}
                    step={BUDGET_SLIDER_STEP}
                    value={budgetSliderMinValue}
                    aria-label="Ngân sách từ"
                    className="pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent accent-sky-700 [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto"
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      const currentMax = parseOptionalNumber(
                        formState.budgetMax,
                      );
                      const bounded =
                        currentMax !== null ? Math.min(next, currentMax) : next;

                      setFormState((previous) => ({
                        ...previous,
                        budgetMin: bounded > 0 ? String(bounded) : "",
                      }));
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={budgetSliderMax}
                    step={BUDGET_SLIDER_STEP}
                    value={budgetSliderMaxValue}
                    aria-label="Ngân sách đến"
                    className="pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent accent-sky-700 [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto"
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      const bounded = Math.max(next, budgetSliderMinValue);

                      setFormState((previous) => ({
                        ...previous,
                        budgetMax:
                          bounded >= budgetSliderMax ? "" : String(bounded),
                      }));
                    }}
                  />
                </div>
              </div>
            </div>
          </FilterField>

          <FilterField label="Ngày từ" htmlFor="search-date-from">
            <input
              id="search-date-from"
              className={controlClass}
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
              className={controlClass}
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
                className={controlClass}
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

        {hasPendingSearchFilterChanges ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Có thay đổi bộ lọc chưa áp dụng. Kết quả và Smart View vẫn đang
              dùng bộ lọc hiện tại.
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={budgetRangeError || publishedDateRangeError}
              leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              onClick={applyDraftFilters}
            >
              Áp dụng ngay
            </Button>
          </div>
        ) : null}

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
      </section>

      <section
        id="search-results"
        className="panel p-4 sm:p-5"
        aria-busy={resultQuery.isFetching ? true : undefined}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Kết quả {SEARCH_MODE_LABELS[mode]}
            </p>
            {result ? (
              <p className="mt-1 text-xs text-slate-500">
                Tổng nguồn: {result.total.toLocaleString("vi-VN")} • Hiển thị
                cửa sổ này: {result.visibleCount} • Cập nhật:{" "}
                {formatDateTime(result.fetchedAt)}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Đang tải dữ liệu public…
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={controlClass}
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
            <div className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!result || page <= 1}
                onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Trước
              </button>
              <span className="text-xs text-slate-500">
                {result ? `Trang ${page}/${totalPages}` : "Trang …"}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!result || page >= totalPages}
                onClick={() =>
                  setPage((previous) => Math.min(totalPages, previous + 1))
                }
              >
                Sau
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              isLoading={resultQuery.isFetching}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => resultQuery.refetch()}
            >
              Tải lại
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              isLoading={saveSelectedResults.isPending}
              disabled={selectedItems.length === 0 || isShowingPreviousResults}
              leftIcon={<Save className="h-3.5 w-3.5" />}
              onClick={() =>
                saveSelectedResults.mutate({
                  items: selectedItems.map((item) => toSavePayload(item)),
                })
              }
            >
              {`Lưu ${selectedItems.length} ${entityLabel.toLowerCase()}`}
            </Button>
          </div>
        </div>

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

        {isShowingPreviousResults ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Đang tải kết quả mới…
          </div>
        ) : null}

        {resultQuery.isError && !result ? (
          <EmptyState
            className="mt-6"
            title={`Không tải được ${entityLabel.toLowerCase()}`}
            description={
              resultQuery.error?.message ??
              "Nguồn public có thể tạm thời không phản hồi."
            }
            cta={
              <Button
                variant="secondary"
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={() => resultQuery.refetch()}
              >
                Tải lại dữ liệu
              </Button>
            }
          />
        ) : isInitialResultsLoading ? (
          <div className="mt-4" role="status" aria-label="Đang tải kết quả">
            <SkeletonTable rows={6} cols={8} />
          </div>
        ) : result ? (
          <>
            {items.length === 0 ? (
              <>
                <div className="mt-3">
                  <SourceMetaBanner result={result} />
                </div>
                <EmptyState
                  className="mt-6"
                  title={`Không có ${entityLabel.toLowerCase()} phù hợp`}
                  description="Hãy nới bộ lọc, đổi chế độ tìm kiếm hoặc thử tải lại nguồn public của BidWinner."
                  cta={
                    <Button
                      variant="secondary"
                      leftIcon={<RefreshCw className="h-4 w-4" />}
                      onClick={() => resultQuery.refetch()}
                    >
                      Tải lại dữ liệu
                    </Button>
                  }
                />
              </>
            ) : (
              <>
                <div className="mt-4">
                  <ResultMatchSummary result={result} />
                </div>
                <div
                  className={`transition-opacity ${
                    isShowingPreviousResults ? "opacity-60" : "opacity-100"
                  }`}
                >
                  <ResultsTable
                    items={items}
                    selectedKeys={selectedKeys}
                    setSelectedKeys={setSelectedKeys}
                    addWatchlist={addWatchlist}
                  />
                </div>
                <div className="mt-3">
                  <SourceMetaBanner result={result} />
                </div>
              </>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
