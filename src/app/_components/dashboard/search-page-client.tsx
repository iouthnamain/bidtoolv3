"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import {
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import {
  CATEGORY_OPTIONS,
  KEYWORD_OPTIONS,
  PAGE_SIZE_OPTIONS,
  PROVINCE_OPTIONS,
} from "~/constants/search-options";
import { parseOptionalNumber, parsePositiveInt } from "~/lib/search-criteria";
import {
  SEARCH_MODE_DESCRIPTIONS,
  SEARCH_MODE_LABELS,
  type SearchMode,
} from "~/lib/search-modes";
import { getSearchPathForMode } from "~/lib/search-routes";
import {
  Button,
  EmptyState,
  FilterField,
  SkeletonTable,
} from "~/app/_components/ui";

import { ClassifyMultiSelect } from "./search/classify-multi-select";
import { MultiSelectDropdown } from "./search/multi-select-dropdown";
import { ResultsTable } from "./search/results-table";
import {
  ResultMatchSummary,
  SourceMetaBanner,
} from "./search/source-meta-banner";
import { toSavePayload } from "./search/result-actions";
import { formatCompactCurrency, formatDateTime } from "./search/search-format";
import { entityLabelForMode } from "./search/search-types";
import { useSearchPageState } from "./search/use-search-page-state";

const DEFAULT_RESULT_OPTIONS = {
  provinces: [...PROVINCE_OPTIONS],
  keywords: [...KEYWORD_OPTIONS],
  packageCategories: [...CATEGORY_OPTIONS],
  planFields: [] as string[],
  procurementMethods: [] as string[],
  projectGroups: [] as string[],
  classifies: [] as Array<{ id: number; name: string; depth: number }>,
};

const DEFAULT_BUDGET_SLIDER_MAX = 100_000_000_000;
const BUDGET_SLIDER_STEP = 1_000_000;

const controlClass =
  "w-full rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none";

const smartViewFrequencyLabels = {
  daily: "Hằng ngày",
  weekly: "Hằng tuần",
} as const;

export function SearchPageClient({
  fixedMode,
}: { fixedMode?: SearchMode } = {}) {
  const state = useSearchPageState({ fixedMode });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [smartViewOpen, setSmartViewOpen] = useState(false);
  const {
    mode,
    formState,
    setFormState,
    page,
    setPage,
    limit,
    setLimit,
    sortOrder,
    setSortOrder,
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
    isEditingSmartView,
  } = state;

  const filterOptions = result?.options ?? DEFAULT_RESULT_OPTIONS;
  const entityLabel = entityLabelForMode(mode);
  const isInitialResultsLoading = resultQuery.isLoading && !result;
  const isShowingPreviousResults = Boolean(resultQuery.isPlaceholderData);
  const hasSmartViewSaveBlocker =
    budgetRangeError ||
    publishedDateRangeError ||
    hasPendingSearchFilterChanges;
  const isSmartViewPanelOpen = smartViewOpen || isEditingSmartView;

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
      ? Math.min(Math.max(budgetMaxNumber, budgetSliderMinValue), budgetSliderMax)
      : budgetSliderMax;
  const budgetSliderMinPercent =
    budgetSliderMax > 0 ? (budgetSliderMinValue / budgetSliderMax) * 100 : 0;
  const budgetSliderMaxPercent =
    budgetSliderMax > 0 ? (budgetSliderMaxValue / budgetSliderMax) * 100 : 100;

  const applyDraftFiltersOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    applyDraftFilters();
  };

  const resultControls = (
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
      <div className="inline-flex items-center gap-2 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-1 text-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-700 transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!result || page <= 1}
          onClick={() => setPage((previous) => Math.max(1, previous - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Trước
        </button>
        <span className="text-xs text-slate-700">
          {result ? `Trang ${page}/${totalPages}` : "Trang …"}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-700 transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
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
  );

  return (
    <div className="space-y-2">
      <section id="search-modes" className="panel scroll-mt-6 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Chế độ tìm kiếm"
            className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pb-1"
          >
            {(Object.keys(SEARCH_MODE_LABELS) as SearchMode[]).map((tabMode) => {
              const isActive = mode === tabMode;
              const tabHref = getSearchPathForMode(tabMode);

              return (
                <Link
                  key={tabMode}
                  href={tabHref}
                  role="tab"
                  aria-selected={isActive}
                  title={SEARCH_MODE_DESCRIPTIONS[tabMode]}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors duration-0 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
                    isActive
                      ? "border-blue-400 bg-blue-50 text-blue-900"
                      : "border-slate-500 bg-white text-slate-900 shadow-sm hover:border-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  {SEARCH_MODE_LABELS[tabMode]}
                </Link>
              );
            })}
          </div>
          <Link
            href="/saved-items/smart-views"
            className="hidden shrink-0 items-center gap-1.5 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none sm:inline-flex"
          >
            <BookmarkCheck className="h-3.5 w-3.5" aria-hidden />
            Bộ lọc thông minh
          </Link>
        </div>

        <p className="mt-2 text-xs text-slate-700">
          {SEARCH_MODE_DESCRIPTIONS[mode]}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-white p-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-600"
              aria-hidden
            />
            <input
              id="search-keyword"
              aria-label="Từ khóa"
              className={`${controlClass} pl-9`}
              value={formState.keyword}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  keyword: event.target.value,
                }))
              }
              onKeyDown={applyDraftFiltersOnEnter}
              placeholder="Từ khóa, phân tách bằng dấu phẩy"
            />
          </div>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="search-advanced-filters"
            onClick={() => setFiltersOpen((previous) => !previous)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-3 py-2 text-sm font-semibold transition-colors duration-0 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
              filtersOpen || appliedChips.length > 0
                ? "border-blue-300 bg-blue-50 text-blue-800"
                : "border-slate-500 bg-white text-slate-900 shadow-sm hover:border-slate-600 hover:bg-slate-100"
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Bộ lọc
            {appliedChips.length > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white">
                {appliedChips.length}
              </span>
            ) : null}
            <ChevronDown
              className={`h-3.5 w-3.5  ${filtersOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          <Button
            variant="primary"
            className="shrink-0"
            disabled={budgetRangeError || publishedDateRangeError}
            leftIcon={<Search className="h-4 w-4" />}
            onClick={applyDraftFilters}
          >
            Tìm
          </Button>
        </div>

        {appliedChips.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {appliedChips.map((chip) => {
              const isModeChip = chip.startsWith("Chế độ:");

              return (
                <span
                  key={chip}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-400 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                >
                  {chip}
                  {!isModeChip ? (
                    <button
                      type="button"
                      className="-mr-0.5 rounded-full p-0.5 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                      aria-label={`Xóa bộ lọc ${chip}`}
                      onClick={() => removeAppliedChip(chip)}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </span>
              );
            })}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
              onClick={resetFilters}
            >
              <X className="h-3 w-3" aria-hidden />
              Xóa
            </button>
          </div>
        ) : null}

        <div
          id="search-advanced-filters"
          hidden={!filtersOpen}
          className="mt-3 rounded border border-slate-400 bg-slate-50/70 p-3"
        >
          <div className="grid gap-1 lg:grid-cols-2">
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
              <ClassifyMultiSelect
                ariaLabel="Ngành nghề & địa phương"
                options={filterOptions.classifies}
                selected={formState.classifyIds}
                onChange={(next) =>
                  setFormState((previous) => ({
                    ...previous,
                    classifyIds: next,
                  }))
                }
                emptyLabel="Tất cả ngành nghề"
              />
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
            <div className="rounded border border-slate-400 bg-slate-50/80 p-3">
              <div className="grid gap-1 sm:grid-cols-2">
                <label className="flex flex-col gap-1" htmlFor="search-budget-min">
                  <span className="text-xs font-semibold tracking-[0.12em] text-slate-700 uppercase">
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

                <label className="flex flex-col gap-1" htmlFor="search-budget-max">
                  <span className="text-xs font-semibold tracking-[0.12em] text-slate-700 uppercase">
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
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>{formatCompactCurrency(budgetSliderMinValue)}</span>
                  <span>{formatCompactCurrency(budgetSliderMaxValue)}</span>
                </div>
                <div className="relative h-8">
                  <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-slate-200" />
                  <div
                    className="absolute top-3 h-2 rounded-full bg-blue-500"
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
                    className="pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent accent-blue-700 [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto"
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      const currentMax = parseOptionalNumber(formState.budgetMax);
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
                    className="pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent accent-blue-700 [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto"
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
            <div className="inline-flex overflow-hidden rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-0.5 text-sm">
              {(
                [
                  { value: "desc", label: "Mới nhất" },
                  { value: "asc", label: "Cũ nhất" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs font-semibold ${
                    sortOrder === option.value
                      ? "bg-blue-700 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  onClick={() => setSortOrder(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-700">
              Sắp xếp áp dụng ngay; bộ lọc khác cần bấm Tìm.
            </p>
          </FilterField>
          </div>

          {budgetRangeError ? (
            <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Ngân sách đến phải lớn hơn hoặc bằng ngân sách từ.
            </div>
          ) : null}

          {publishedDateRangeError ? (
            <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Ngày đến phải lớn hơn hoặc bằng ngày từ.
            </div>
          ) : null}

        </div>

        <div className="mt-3 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)]">
          <button
            type="button"
            aria-expanded={isSmartViewPanelOpen}
            aria-controls="search-smart-view-panel"
            className="flex w-full items-center justify-between gap-1 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            onClick={() => setSmartViewOpen((previous) => !previous)}
          >
            <span className="inline-flex items-center gap-2">
              <BookmarkCheck className="h-4 w-4 text-blue-700" aria-hidden />
              Bộ lọc thông minh
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-700  ${
                isSmartViewPanelOpen ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </button>

          <div
            id="search-smart-view-panel"
            hidden={!isSmartViewPanelOpen}
            className="border-t border-slate-400 px-3 py-3"
          >
            <div className="grid gap-1 sm:grid-cols-[1.4fr_1fr]">
              <FilterField label="Tên bộ lọc thông minh" htmlFor="smart-view-name">
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
                    setSmartViewFrequency(
                      event.target.value as "daily" | "weekly",
                    )
                  }
                >
                  <option value="daily">Hằng ngày</option>
                  <option value="weekly">Hằng tuần</option>
                </select>
              </FilterField>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                isLoading={saveFilter.isPending || updateSavedFilter.isPending}
                disabled={hasSmartViewSaveBlocker}
                title={
                  hasPendingSearchFilterChanges
                    ? "Áp dụng bộ lọc trước khi lưu"
                    : undefined
                }
                leftIcon={<BookmarkCheck className="h-4 w-4" />}
                onClick={persistSmartView}
              >
                {isEditingSmartView ? "Cập nhật bộ lọc thông minh" : "Lưu bộ lọc thông minh"}
              </Button>
              {hasPendingSearchFilterChanges ? (
                <span className="text-xs text-amber-700">
                  Áp dụng bộ lọc trước khi lưu bộ lọc thông minh.
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {isEditingSmartView ? (
          <div className="mt-4 rounded border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-1">
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  {savedFilterQuery.isPending
                    ? "Đang tải bộ lọc thông minh để chỉnh sửa"
                    : savedFilterQuery.error
                      ? "Không mở được bộ lọc thông minh"
                      : "Đang chỉnh sửa bộ lọc thông minh"}
                </p>
                <p className="mt-1 text-xs text-blue-800">
                  {savedFilterQuery.error?.message ??
                    "Cập nhật bộ lọc thông minh sẽ không sửa workflow đã tạo trước đó."}
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Có thay đổi bộ lọc chưa áp dụng. Kết quả và bộ lọc thông minh vẫn đang
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
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {saveError}
          </div>
        ) : null}

        {smartViewSuccess ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {smartViewSuccess} • {smartViewFrequencyLabels[smartViewFrequency]}
          </div>
        ) : null}
      </section>

      <section
        id="search-results"
        className="panel rounded p-4"
        aria-busy={resultQuery.isFetching ? true : undefined}
      >
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div>
            <p className="text-sm font-bold text-slate-900">
              Kết quả {SEARCH_MODE_LABELS[mode]}
            </p>
            {result ? (
              <p className="mt-1 text-xs text-slate-700">
                {result.localRefinement.active
                  ? `Phù hợp bộ lọc: ${result.total.toLocaleString("vi-VN")} • Đã quét ${result.scannedCount.toLocaleString("vi-VN")} mục nguồn`
                  : `Tổng nguồn: ${result.total.toLocaleString("vi-VN")}`}{" "}
                • Trang này: {result.items.length} • Cập nhật:{" "}
                {formatDateTime(result.fetchedAt)}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-700">
                Đang tải dữ liệu public…
              </p>
            )}
          </div>
          {resultControls}
        </div>

        {saveSelectedSuccess ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {saveSelectedSuccess}
          </div>
        ) : null}

        {saveSelectedError ? (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {saveSelectedError}
          </div>
        ) : null}

        {watchlistSuccess ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {watchlistSuccess}
          </div>
        ) : null}

        {isShowingPreviousResults ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
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
                <div className="mt-3">
                  <SourceMetaBanner result={result} />
                </div>
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
                <div className="mt-4 flex justify-end">
                  {resultControls}
                </div>
              </>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
