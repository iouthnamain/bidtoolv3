"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Filter,
  LayoutGrid,
  ListChecks,
  Loader2,
  Package,
  RotateCcw,
  Rows2,
  Rows3,
  Search,
  SlidersHorizontal,
  StopCircle,
  Table2,
  Trash2,
  X,
} from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import {
  SelectionCheckbox,
  SortableHeader,
  loadColumnVisibility as loadColumnVisibilityShared,
  loadDensity as loadDensityShared,
  loadViewMode as loadViewModeShared,
  tableCellClass,
  tableHeaderClass,
  type SortOrder,
  type TableDensity,
  type ViewMode,
} from "~/app/_components/materials/list-table-helpers";
import {
  detailEnrichmentLabel,
  elapsedMsForJob,
  formatDateTime,
  formatDuration,
  formatLimit,
  scrapeMethodLabel,
  scrapeModeLabel,
  statusLabel,
  statusTone,
  stopReasonLabel,
} from "~/app/_components/materials/scrape-display";
import {
  SCRAPE_JOBS_LIST_CAP,
  hostFromUrl,
  isJobActive,
  type DetailEnrichmentMode,
  type ScrapeJob,
  type ScrapeJobListItem,
  type ScrapeMethod,
} from "~/app/_components/materials/scrape-job-utils";

type PreviewStatus = {
  label: string;
  tone: Parameters<typeof Badge>[0]["tone"];
  detail: string | null;
};

function previewStatusForJob(
  job: ScrapeJobListItem,
  options?: { focused?: boolean },
): PreviewStatus {
  const focused = options?.focused ?? false;

  if (job.isExpired) {
    return {
      label: "Hết hạn",
      tone: "warning",
      detail: "Bản xem trước không còn khả dụng",
    };
  }

  if (job.status === "queued") {
    return {
      label: "Chờ scrape",
      tone: "neutral",
      detail: "Chưa có sản phẩm để xem",
    };
  }

  if (job.status === "running") {
    if (job.productCount > 0) {
      return {
        label: focused ? "Đang xem trước" : "Xem trước tạm thời",
        tone: "info",
        detail: `${job.productCount.toLocaleString("vi-VN")} SP — cập nhật liên tục`,
      };
    }
    return {
      label: "Đang tìm SP",
      tone: "neutral",
      detail: job.message ?? "Chưa có sản phẩm trong preview",
    };
  }

  if (job.status === "completed") {
    if (job.productCount > 0) {
      return {
        label: focused ? "Đang xem preview" : "Sẵn sàng duyệt",
        tone: "success",
        detail: `${job.productCount.toLocaleString("vi-VN")} SP có thể chọn và nhập`,
      };
    }
    return {
      label: "Không có SP",
      tone: "warning",
      detail: job.stopReason
        ? stopReasonLabel[job.stopReason]
        : "Không tìm thấy sản phẩm",
    };
  }

  if (job.status === "failed") {
    return {
      label: "Lỗi xem trước",
      tone: "critical",
      detail: job.error ?? job.message ?? "Job scrape thất bại",
    };
  }

  return {
    label: "Đã hủy",
    tone: "warning",
    detail:
      job.productCount > 0
        ? `${job.productCount.toLocaleString("vi-VN")} SP đã scrape trước khi hủy`
        : "Không có preview",
  };
}

function scrapeStateDetail(job: ScrapeJobListItem) {
  if (isJobActive(job)) {
    return (
      job.message ??
      (job.queueLength > 0
        ? `Queue còn ${job.queueLength.toLocaleString("vi-VN")} URL`
        : null) ??
      (job.currentUrls.length > 0
        ? `Đang đọc ${job.currentUrls.length.toLocaleString("vi-VN")} trang`
        : null)
    );
  }

  if (job.stopReason) {
    return stopReasonLabel[job.stopReason];
  }

  return job.message ?? job.error ?? null;
}

function ScrapeJobConfigBadges({ job }: { job: ScrapeJobListItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={job.scrapeMode === "all" ? "info" : "neutral"}>
        {scrapeModeLabel[job.scrapeMode]}
      </Badge>
      <Badge tone="neutral">{scrapeMethodLabel[job.method]}</Badge>
      <Badge
        tone={
          job.detailEnrichment === "missing_fields" ? "info" : "warning"
        }
      >
        {detailEnrichmentLabel[job.detailEnrichment]}
      </Badge>
      {job.scrapeMode === "limited" ? (
        <span className="text-xs font-medium text-slate-700">
          {formatLimit(job.maxPages)} trang · {formatLimit(job.maxProducts)} SP
        </span>
      ) : (
        <span className="text-xs font-medium text-slate-700">
          Không giới hạn
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scrape jobs list (TanStack-table-driven, client-side sort/filter/pagination)
// ---------------------------------------------------------------------------

const SCRAPE_JOBS_COLUMN_VISIBILITY_KEY = "bidtool:scrape-jobs-columns:v1";
const SCRAPE_JOBS_DENSITY_KEY = "bidtool:scrape-jobs-density:v1";
const SCRAPE_JOBS_VIEW_MODE_KEY = "bidtool:scrape-jobs-view-mode:v1";
const SCRAPE_JOBS_PAGE_SIZE_OPTIONS = [25, 50, 80, 100] as const;
const DEFAULT_SCRAPE_JOBS_PAGE_SIZE = 25;
const scrapeJobControlClass =
  "min-h-11 w-full rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none";

type ScrapeJobSortBy =
  | "shop"
  | "status"
  | "productCount"
  | "pages"
  | "duration"
  | "expiresAt";
type ScrapeJobSortKey = ScrapeJobSortBy | "default";
type ScrapeJobStatusFilter = "all" | ScrapeJob["status"];
type ScrapeJobMethodFilter = "all" | ScrapeMethod;
type ScrapeJobEnrichmentFilter = "all" | DetailEnrichmentMode;

const scrapeJobStatusRank: Record<ScrapeJob["status"], number> = {
  running: 0,
  queued: 1,
  completed: 2,
  cancelled: 3,
  failed: 4,
};

const scrapeJobStatusFilterOptions: Array<{
  value: ScrapeJobStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "queued", label: statusLabel.queued },
  { value: "running", label: statusLabel.running },
  { value: "completed", label: statusLabel.completed },
  { value: "failed", label: statusLabel.failed },
  { value: "cancelled", label: statusLabel.cancelled },
];

const scrapeJobMethodFilterOptions: Array<{
  value: ScrapeJobMethodFilter;
  label: string;
}> = [
  { value: "all", label: "Tất cả cách đọc" },
  { value: "auto", label: scrapeMethodLabel.auto },
  { value: "json_ld", label: scrapeMethodLabel.json_ld },
  { value: "dom_cards", label: scrapeMethodLabel.dom_cards },
];

const scrapeJobEnrichmentFilterOptions: Array<{
  value: ScrapeJobEnrichmentFilter;
  label: string;
}> = [
  { value: "all", label: "Tất cả bổ sung" },
  { value: "none", label: detailEnrichmentLabel.none },
  { value: "missing_fields", label: detailEnrichmentLabel.missing_fields },
];

const scrapeJobColumnOptions: Array<{ id: string; label: string }> = [
  { id: "config", label: "Cấu hình" },
  { id: "preview", label: "Xem trước SP" },
  { id: "pages", label: "Trang" },
  { id: "duration", label: "Thời gian" },
  { id: "expiresAt", label: "Hết hạn" },
];

const scrapeJobColumnWidthClass: Record<string, string> = {
  select: "w-12",
  stt: "w-12",
  shop: "w-[20%]",
  config: "w-[16%]",
  status: "w-[12%]",
  preview: "w-[12%]",
  productCount: "w-20",
  pages: "w-24",
  duration: "w-24",
  expiresAt: "w-36",
  actions: "w-16",
};

const scrapeJobCellBaseClass: Record<string, string> = {
  select: "text-center align-top",
  stt: "text-center align-top text-slate-700 tabular-nums",
  shop: "align-top",
  config: "align-top",
  status: "align-top",
  preview: "align-top",
  productCount: "align-top font-semibold text-slate-900 tabular-nums",
  pages: "align-top text-slate-600",
  duration: "align-top text-slate-600 tabular-nums",
  expiresAt: "align-top text-slate-600",
  actions: "align-top text-right",
};

function scrapeJobHeaderClass(columnId: string, density: TableDensity) {
  const width = scrapeJobColumnWidthClass[columnId] ?? "";
  const align =
    columnId === "select" || columnId === "stt"
      ? "center"
      : columnId === "actions"
        ? "right"
        : "left";
  return tableHeaderClass(width, density, align);
}

function scrapeJobCellClass(columnId: string, density: TableDensity) {
  const width = scrapeJobColumnWidthClass[columnId] ?? "";
  const base = scrapeJobCellBaseClass[columnId] ?? "align-top";
  return tableCellClass(base, density, width);
}

function compareScrapeJobs(
  a: ScrapeJobListItem,
  b: ScrapeJobListItem,
  sortBy: ScrapeJobSortKey,
  sortOrder: SortOrder,
  nowMs: number,
) {
  if (sortBy === "default") {
    // Server "active-first" intent: active jobs first, then startedAt desc.
    const aActive = isJobActive(a) ? 1 : 0;
    const bActive = isJobActive(b) ? 1 : 0;
    if (aActive !== bActive) {
      return bActive - aActive;
    }
    return (
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  const direction = sortOrder === "asc" ? 1 : -1;
  let diff = 0;
  switch (sortBy) {
    case "shop":
      diff = hostFromUrl(a.url).localeCompare(hostFromUrl(b.url), "vi");
      break;
    case "status":
      diff = scrapeJobStatusRank[a.status] - scrapeJobStatusRank[b.status];
      break;
    case "productCount":
      diff = a.productCount - b.productCount;
      break;
    case "pages":
      diff = a.pagesVisited.length - b.pagesVisited.length;
      break;
    case "duration":
      diff = elapsedMsForJob(a, nowMs) - elapsedMsForJob(b, nowMs);
      break;
    case "expiresAt": {
      const aExp = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
      const bExp = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
      diff = aExp - bExp;
      break;
    }
  }

  if (diff === 0) {
    // Stable tiebreak by startedAt desc.
    diff =
      new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    return -diff;
  }
  return diff * direction;
}

function ScrapeJobCard({
  job,
  rowNumber,
  selected,
  focused,
  isStopping,
  isDeleting,
  onFocus,
  onStop,
  onDelete,
  onToggleSelected,
  clockMs,
}: {
  job: ScrapeJobListItem;
  rowNumber: number;
  selected: boolean;
  focused: boolean;
  isStopping: boolean;
  isDeleting: boolean;
  onFocus: (jobId: string) => void;
  onStop: (job: { id: string; url: string }) => void;
  onDelete: (job: { id: string; url: string }) => void;
  onToggleSelected: () => void;
  clockMs: number;
}) {
  const active = isJobActive(job);
  const preview = previewStatusForJob(job, { focused });
  const stateDetail = scrapeStateDetail(job);

  return (
    <article
      className={
        focused
          ? "rounded border border-blue-300 bg-blue-50/80 p-3 shadow-[var(--shadow-raised)]"
          : selected
            ? "rounded border border-blue-200 bg-blue-50/50 p-3 shadow-[var(--shadow-raised)]"
            : "rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3 shadow-[var(--shadow-raised)]"
      }
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <SelectionCheckbox
          checked={selected}
          ariaLabel={`Chọn job ${hostFromUrl(job.url)}`}
          onChange={onToggleSelected}
        />
        <button
          type="button"
          className="min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          onClick={() => onFocus(job.id)}
          aria-current={focused ? "true" : undefined}
          aria-label={`Xem job ${hostFromUrl(job.url)}`}
        >
          <span className="text-xs font-semibold text-slate-600 tabular-nums">
            STT {rowNumber.toLocaleString("vi-VN")}
          </span>
          <span className="block truncate text-sm font-semibold text-slate-950">
            {hostFromUrl(job.url)}
          </span>
          <span className="mt-1 line-clamp-2 text-xs break-all text-slate-700">
            {job.url}
          </span>
        </button>
        {active ? (
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-amber-200 bg-white text-amber-800 transition-colors duration-0 hover:bg-amber-50 hover:text-amber-900 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
            disabled={isStopping}
            onClick={() => onStop(job)}
            aria-label={`Dừng job ${hostFromUrl(job.url)}`}
            title="Dừng job"
          >
            {isStopping ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <StopCircle className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-rose-200 bg-white text-rose-700 transition-colors duration-0 hover:bg-rose-50 hover:text-rose-800 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
            disabled={isDeleting}
            onClick={() => onDelete(job)}
            aria-label={`Xóa job ${hostFromUrl(job.url)}`}
            title="Xóa job"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-3">
        <ScrapeJobConfigBadges job={job} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone[job.status]}>
          {active ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : null}
          {statusLabel[job.status]}
        </Badge>
        <Badge tone={preview.tone}>{preview.label}</Badge>
        <Badge tone="neutral" count={job.productCount}>
          Sản phẩm
        </Badge>
        <Badge tone="neutral" count={job.pagesVisited.length}>
          Trang
        </Badge>
      </div>
      {stateDetail ? (
        <p className="mt-2 text-xs text-slate-600">{stateDetail}</p>
      ) : null}
      {preview.detail ? (
        <p className="mt-1 text-xs font-medium text-slate-700">
          {preview.detail}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-white/80 px-2 py-1.5">
          <dt className="font-semibold text-slate-700">Thời gian</dt>
          <dd className="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {formatDuration(elapsedMsForJob(job, clockMs))}
          </dd>
        </div>
        <div className="rounded bg-white/80 px-2 py-1.5">
          <dt className="font-semibold text-slate-700">Hết hạn</dt>
          <dd className="mt-0.5 truncate font-semibold text-slate-900">
            {formatDateTime(job.expiresAt)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function ScrapeJobsList({
  jobRows,
  focusedJobId,
  clockMs,
  isFetching,
  onRefresh,
  onFocusJob,
  onStopJob,
  onDeleteJob,
  stoppingJobId,
  isDeletingJob,
}: {
  jobRows: ScrapeJobListItem[];
  focusedJobId: string | null;
  clockMs: number;
  isFetching: boolean;
  onRefresh: () => void;
  onFocusJob: (jobId: string) => void;
  onStopJob: (job: { id: string; url: string }) => void;
  onDeleteJob: (job: { id: string; url: string }) => void;
  stoppingJobId: string | null;
  isDeletingJob: boolean;
}) {
  const [hasMounted, setHasMounted] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ScrapeJobStatusFilter>("all");
  const [methodFilter, setMethodFilter] =
    useState<ScrapeJobMethodFilter>("all");
  const [enrichmentFilter, setEnrichmentFilter] =
    useState<ScrapeJobEnrichmentFilter>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [hasProductsOnly, setHasProductsOnly] = useState(false);
  const [errorOnly, setErrorOnly] = useState(false);
  const [sortBy, setSortBy] = useState<ScrapeJobSortKey>("default");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_SCRAPE_JOBS_PAGE_SIZE,
  });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState("1");

  useEffect(() => {
    setHasMounted(true);
    setColumnVisibility(
      loadColumnVisibilityShared(SCRAPE_JOBS_COLUMN_VISIBILITY_KEY, {}),
    );
    setDensity(loadDensityShared(SCRAPE_JOBS_DENSITY_KEY));
    setViewMode(loadViewModeShared(SCRAPE_JOBS_VIEW_MODE_KEY));
  }, []);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }
    localStorage.setItem(
      SCRAPE_JOBS_COLUMN_VISIBILITY_KEY,
      JSON.stringify(columnVisibility),
    );
  }, [columnVisibility, hasMounted]);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }
    localStorage.setItem(SCRAPE_JOBS_DENSITY_KEY, density);
  }, [density, hasMounted]);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }
    localStorage.setItem(SCRAPE_JOBS_VIEW_MODE_KEY, viewMode);
  }, [viewMode, hasMounted]);

  useEffect(() => {
    if (!showColumnPicker) {
      return;
    }
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!columnPickerRef.current?.contains(event.target as Node)) {
        setShowColumnPicker(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showColumnPicker]);

  const stats = useMemo(() => {
    let active = 0;
    let completed = 0;
    let withProducts = 0;
    let errored = 0;
    for (const job of jobRows) {
      if (isJobActive(job)) {
        active += 1;
      }
      if (job.status === "completed") {
        completed += 1;
      }
      if (job.productCount > 0) {
        withProducts += 1;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        errored += 1;
      }
    }
    return { total: jobRows.length, active, completed, withProducts, errored };
  }, [jobRows]);

  const filteredJobs = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return jobRows.filter((job) => {
      if (needle) {
        const haystack = [
          hostFromUrl(job.url),
          job.url,
          job.message ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      if (statusFilter !== "all" && job.status !== statusFilter) {
        return false;
      }
      if (methodFilter !== "all" && job.method !== methodFilter) {
        return false;
      }
      if (
        enrichmentFilter !== "all" &&
        job.detailEnrichment !== enrichmentFilter
      ) {
        return false;
      }
      if (activeOnly && !isJobActive(job)) {
        return false;
      }
      if (hasProductsOnly && job.productCount <= 0) {
        return false;
      }
      if (
        errorOnly &&
        job.status !== "failed" &&
        job.status !== "cancelled"
      ) {
        return false;
      }
      return true;
    });
  }, [
    jobRows,
    keyword,
    statusFilter,
    methodFilter,
    enrichmentFilter,
    activeOnly,
    hasProductsOnly,
    errorOnly,
  ]);

  const sortedJobs = useMemo(() => {
    const copy = [...filteredJobs];
    copy.sort((a, b) => compareScrapeJobs(a, b, sortBy, sortOrder, clockMs));
    return copy;
    // clockMs intentionally excluded: duration sort should not reshuffle every
    // second while polling; it is applied on the next user interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredJobs, sortBy, sortOrder]);

  const totalFiltered = sortedJobs.length;
  const totalPages = Math.max(
    1,
    Math.ceil(totalFiltered / pagination.pageSize),
  );
  const currentPage = pagination.pageIndex + 1;

  useEffect(() => {
    setPageJumpValue(String(currentPage));
  }, [currentPage]);

  // Clamp page index when the filtered set shrinks.
  useEffect(() => {
    const lastPageIndex = Math.max(0, totalPages - 1);
    setPagination((current) =>
      current.pageIndex > lastPageIndex
        ? { ...current, pageIndex: lastPageIndex }
        : current,
    );
  }, [totalPages]);

  // Reset to first page whenever filters/sort change.
  const filterSignature = `${keyword}|${statusFilter}|${methodFilter}|${enrichmentFilter}|${activeOnly}|${hasProductsOnly}|${errorOnly}|${sortBy}|${sortOrder}`;
  const didInitFilterSignatureRef = useRef(false);
  useEffect(() => {
    if (!didInitFilterSignatureRef.current) {
      didInitFilterSignatureRef.current = true;
      return;
    }
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [filterSignature]);

  const pageStart =
    totalFiltered === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const pageEnd = Math.min(
    (pagination.pageIndex + 1) * pagination.pageSize,
    totalFiltered,
  );

  const goToPage = (pageIndex: number) => {
    setPagination((current) => ({
      ...current,
      pageIndex: Math.min(Math.max(pageIndex, 0), totalPages - 1),
    }));
  };

  const submitPageJump = () => {
    const page = Number.parseInt(pageJumpValue, 10);
    if (!Number.isInteger(page)) {
      setPageJumpValue(String(currentPage));
      return;
    }
    goToPage(page - 1);
  };

  const toggleColumnSort = useCallback(
    (column: ScrapeJobSortBy) => {
      setSortBy((currentSortBy) => {
        if (currentSortBy === column) {
          setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
          return currentSortBy;
        }
        setSortOrder(column === "shop" ? "asc" : "desc");
        return column;
      });
    },
    [],
  );

  const resetViewControls = () => {
    setKeyword("");
    setStatusFilter("all");
    setMethodFilter("all");
    setEnrichmentFilter("all");
    setActiveOnly(false);
    setHasProductsOnly(false);
    setErrorOnly(false);
    setSortBy("default");
    setSortOrder("desc");
    setPagination({ pageIndex: 0, pageSize: DEFAULT_SCRAPE_JOBS_PAGE_SIZE });
    setRowSelection({});
  };

  const activeFilterCount = [
    keyword.trim(),
    statusFilter !== "all" ? statusFilter : "",
    methodFilter !== "all" ? methodFilter : "",
    enrichmentFilter !== "all" ? enrichmentFilter : "",
    activeOnly ? "active" : "",
    hasProductsOnly ? "products" : "",
    errorOnly ? "error" : "",
  ].filter(Boolean).length;

  const hasActiveViewControls =
    activeFilterCount > 0 ||
    sortBy !== "default" ||
    pagination.pageIndex > 0 ||
    pagination.pageSize !== DEFAULT_SCRAPE_JOBS_PAGE_SIZE;

  const activeFilterChips = useMemo(() => {
    const chips: Array<{
      key: string;
      label: string;
      value: string;
      onClear: () => void;
    }> = [];
    if (keyword.trim()) {
      chips.push({
        key: "q",
        label: "Tìm kiếm",
        value: keyword.trim(),
        onClear: () => setKeyword(""),
      });
    }
    if (statusFilter !== "all") {
      chips.push({
        key: "status",
        label: "Trạng thái",
        value:
          scrapeJobStatusFilterOptions.find(
            (option) => option.value === statusFilter,
          )?.label ?? statusFilter,
        onClear: () => setStatusFilter("all"),
      });
    }
    if (methodFilter !== "all") {
      chips.push({
        key: "method",
        label: "Cách đọc",
        value:
          scrapeJobMethodFilterOptions.find(
            (option) => option.value === methodFilter,
          )?.label ?? methodFilter,
        onClear: () => setMethodFilter("all"),
      });
    }
    if (enrichmentFilter !== "all") {
      chips.push({
        key: "enrichment",
        label: "Bổ sung",
        value:
          scrapeJobEnrichmentFilterOptions.find(
            (option) => option.value === enrichmentFilter,
          )?.label ?? enrichmentFilter,
        onClear: () => setEnrichmentFilter("all"),
      });
    }
    if (activeOnly) {
      chips.push({
        key: "active",
        label: "Lọc",
        value: "Đang chạy",
        onClear: () => setActiveOnly(false),
      });
    }
    if (hasProductsOnly) {
      chips.push({
        key: "products",
        label: "Lọc",
        value: "Có sản phẩm",
        onClear: () => setHasProductsOnly(false),
      });
    }
    if (errorOnly) {
      chips.push({
        key: "error",
        label: "Lọc",
        value: "Lỗi / hủy",
        onClear: () => setErrorOnly(false),
      });
    }
    return chips;
  }, [
    keyword,
    statusFilter,
    methodFilter,
    enrichmentFilter,
    activeOnly,
    hasProductsOnly,
    errorOnly,
  ]);

  const columns = useMemo<ColumnDef<ScrapeJobListItem>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        header: ({ table }) => (
          <SelectionCheckbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            disabled={table.getRowModel().rows.length === 0}
            ariaLabel="Chọn tất cả job đang hiển thị"
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <SelectionCheckbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            ariaLabel={`Chọn job ${hostFromUrl(row.original.url)}`}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        id: "stt",
        enableHiding: false,
        header: () => <span className="text-slate-700">STT</span>,
        cell: ({ row }) => (
          <span>
            {(
              pagination.pageIndex * pagination.pageSize +
              row.index +
              1
            ).toLocaleString("vi-VN")}
          </span>
        ),
      },
      {
        id: "shop",
        enableHiding: false,
        header: () => (
          <SortableHeader
            label="Shop"
            columnId="shop"
            sortBy={sortBy as ScrapeJobSortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            className="block w-full rounded text-left focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            onClick={() => onFocusJob(row.original.id)}
            aria-label={`Xem job ${hostFromUrl(row.original.url)}`}
          >
            <span className="block truncate font-semibold text-slate-950 hover:text-blue-700">
              {hostFromUrl(row.original.url)}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-700">
              {row.original.url}
            </span>
          </button>
        ),
      },
      {
        id: "config",
        header: "Cấu hình scrape",
        cell: ({ row }) => <ScrapeJobConfigBadges job={row.original} />,
      },
      {
        id: "status",
        header: () => (
          <SortableHeader
            label="Trạng thái"
            columnId="status"
            sortBy={sortBy as ScrapeJobSortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => {
          const stateDetail = scrapeStateDetail(row.original);
          return (
            <div>
              <Badge tone={statusTone[row.original.status]}>
                {isJobActive(row.original) ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : null}
                {statusLabel[row.original.status]}
              </Badge>
              {stateDetail ? (
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                  {stateDetail}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "preview",
        header: "Xem trước SP",
        cell: ({ row }) => {
          const preview = previewStatusForJob(row.original, {
            focused: focusedJobId === row.original.id,
          });
          return (
            <div>
              <Badge tone={preview.tone}>{preview.label}</Badge>
              {preview.detail ? (
                <p className="mt-1 line-clamp-2 text-xs text-slate-700">
                  {preview.detail}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "productCount",
        header: () => (
          <SortableHeader
            label="Sản phẩm"
            columnId="productCount"
            sortBy={sortBy as ScrapeJobSortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => row.original.productCount.toLocaleString("vi-VN"),
      },
      {
        id: "pages",
        header: () => (
          <SortableHeader
            label="Trang"
            columnId="pages"
            sortBy={sortBy as ScrapeJobSortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) =>
          `${row.original.pagesVisited.length.toLocaleString("vi-VN")} / ${formatLimit(
            row.original.maxPages,
          )}`,
      },
      {
        id: "duration",
        header: () => (
          <SortableHeader
            label="Thời gian"
            columnId="duration"
            sortBy={sortBy as ScrapeJobSortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) =>
          formatDuration(elapsedMsForJob(row.original, clockMs)),
      },
      {
        id: "expiresAt",
        header: () => (
          <SortableHeader
            label="Hết hạn"
            columnId="expiresAt"
            sortBy={sortBy as ScrapeJobSortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => formatDateTime(row.original.expiresAt),
      },
      {
        id: "actions",
        enableHiding: false,
        header: "",
        cell: ({ row }) => {
          const active = isJobActive(row.original);
          const isStopping = stoppingJobId === row.original.id;
          return active ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-amber-500 bg-white text-amber-800 shadow-[var(--shadow-flat)] transition-colors duration-0 hover:border-amber-600 hover:bg-amber-50 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:opacity-60"
              disabled={stoppingJobId !== null}
              onClick={(event) => {
                event.stopPropagation();
                onStopJob(row.original);
              }}
              aria-label={`Dừng job ${hostFromUrl(row.original.url)}`}
              title="Dừng job"
            >
              {isStopping ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <StopCircle className="h-4 w-4" aria-hidden />
              )}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-rose-500 bg-white text-rose-700 shadow-[var(--shadow-flat)] transition-colors duration-0 hover:border-rose-600 hover:bg-rose-50 hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:opacity-60"
              disabled={isDeletingJob}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteJob(row.original);
              }}
              aria-label={`Xóa job ${hostFromUrl(row.original.url)}`}
              title="Xóa job"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          );
        },
      },
    ],
    [
      clockMs,
      focusedJobId,
      isDeletingJob,
      onDeleteJob,
      onFocusJob,
      onStopJob,
      pagination.pageIndex,
      pagination.pageSize,
      sortBy,
      sortOrder,
      stoppingJobId,
      toggleColumnSort,
    ],
  );

  // TanStack manual pagination does not slice rows; slice the sorted set here.
  const paginatedJobs = useMemo(
    () =>
      sortedJobs.slice(
        pagination.pageIndex * pagination.pageSize,
        pagination.pageIndex * pagination.pageSize + pagination.pageSize,
      ),
    [sortedJobs, pagination.pageIndex, pagination.pageSize],
  );

  const pageTable = useReactTable({
    data: paginatedJobs,
    columns,
    state: { pagination, rowSelection, columnVisibility },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    enableHiding: true,
    manualPagination: true,
    pageCount: totalPages,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  const visibleRows = pageTable.getRowModel().rows;
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  const handleRowClick = (
    event: ReactMouseEvent<HTMLTableRowElement>,
    jobId: string,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, label, [role='button']")) {
      return;
    }
    onFocusJob(jobId);
  };

  const renderPaginationBar = () => (
    <div className="mt-3 flex flex-col gap-1 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div
        className="flex flex-wrap items-center gap-2 text-xs text-slate-600"
        aria-live="polite"
      >
        <span className="font-semibold text-slate-900">
          {pageStart.toLocaleString("vi-VN")}-{pageEnd.toLocaleString("vi-VN")}
        </span>
        <span>/ {totalFiltered.toLocaleString("vi-VN")} job</span>
        <span className="text-slate-300" aria-hidden>
          |
        </span>
        <label className="inline-flex items-center gap-2">
          <span>Số dòng</span>
          <select
            className="h-10 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 text-xs font-semibold text-slate-800 shadow-sm focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none sm:h-8"
            aria-label="Số dòng mỗi trang"
            value={pagination.pageSize}
            onChange={(event) => {
              const pageSize = Number(event.target.value);
              setPagination({ pageIndex: 0, pageSize });
            }}
          >
            {SCRAPE_JOBS_PAGE_SIZE_OPTIONS.map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                {pageSize.toLocaleString("vi-VN")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-24 text-center text-xs font-semibold text-slate-600">
          Trang {currentPage.toLocaleString("vi-VN")} /{" "}
          {totalPages.toLocaleString("vi-VN")}
        </span>
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <span className="sr-only">Nhảy tới trang</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageJumpValue}
            aria-label="Nhảy tới trang"
            className="h-10 w-14 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 text-center text-xs font-semibold text-slate-800 shadow-sm focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none sm:h-8"
            onChange={(event) => setPageJumpValue(event.target.value)}
            onBlur={submitPageJump}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitPageJump();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
          aria-label="Trang đầu"
          disabled={pagination.pageIndex === 0}
          onClick={() => goToPage(0)}
        >
          <ChevronsLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
          aria-label="Trang trước"
          disabled={pagination.pageIndex === 0}
          onClick={() => goToPage(pagination.pageIndex - 1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
          aria-label="Trang sau"
          disabled={pagination.pageIndex + 1 >= totalPages}
          onClick={() => goToPage(pagination.pageIndex + 1)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
          aria-label="Trang cuối"
          disabled={pagination.pageIndex + 1 >= totalPages}
          onClick={() => goToPage(totalPages - 1)}
        >
          <ChevronsRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );

  const listCapped = jobRows.length >= SCRAPE_JOBS_LIST_CAP;

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <button
          type="button"
          className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-blue-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          onClick={resetViewControls}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">Tổng job</p>
            <ListChecks className="h-3.5 w-3.5 text-slate-600" aria-hidden />
          </div>
          <p className="mt-0.5 text-base font-bold text-slate-950">
            {stats.total.toLocaleString("vi-VN")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-700">
            Bấm để xóa bộ lọc
          </p>
        </button>
        <button
          type="button"
          className={`rounded border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-blue-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
            activeOnly
              ? "border-blue-400 ring-2 ring-blue-300"
              : "border-blue-200 bg-blue-50/70"
          }`}
          onClick={() => setActiveOnly((current) => !current)}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-blue-700">Đang chạy</p>
            <Loader2 className="h-3.5 w-3.5 text-blue-600" aria-hidden />
          </div>
          <p className="mt-0.5 text-base font-bold text-blue-950 tabular-nums">
            {stats.active.toLocaleString("vi-VN")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-blue-700">
            Lọc job đang scrape
          </p>
        </button>
        <button
          type="button"
          className={`rounded border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none ${
            statusFilter === "completed"
              ? "border-emerald-400 ring-2 ring-emerald-300"
              : "border-emerald-200 bg-emerald-50/70"
          }`}
          onClick={() =>
            setStatusFilter((current) =>
              current === "completed" ? "all" : "completed",
            )
          }
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-emerald-700">Hoàn tất</p>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          </div>
          <p className="mt-0.5 text-base font-bold text-emerald-900 tabular-nums">
            {stats.completed.toLocaleString("vi-VN")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-emerald-700">
            Lọc job hoàn tất
          </p>
        </button>
        <button
          type="button"
          className={`rounded border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-violet-200 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none ${
            hasProductsOnly
              ? "border-violet-400 ring-2 ring-violet-300"
              : "border-violet-200 bg-violet-50/70"
          }`}
          onClick={() => setHasProductsOnly((current) => !current)}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-violet-700">Có sản phẩm</p>
            <Package className="h-3.5 w-3.5 text-violet-600" aria-hidden />
          </div>
          <p className="mt-0.5 text-base font-bold text-violet-950 tabular-nums">
            {stats.withProducts.toLocaleString("vi-VN")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-violet-700">
            Lọc job có preview SP
          </p>
        </button>
        <button
          type="button"
          className={`rounded border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-amber-200 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none ${
            errorOnly
              ? "border-amber-400 ring-2 ring-amber-300"
              : "border-amber-200 bg-amber-50/70"
          }`}
          onClick={() => setErrorOnly((current) => !current)}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-700">Lỗi / hủy</p>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
          </div>
          <p className="mt-0.5 text-base font-bold text-amber-900 tabular-nums">
            {stats.errored.toLocaleString("vi-VN")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-amber-700">
            Lọc job lỗi hoặc đã hủy
          </p>
        </button>
      </div>

      <div className="grid gap-1 border-b border-slate-400 pb-3 lg:grid-cols-[minmax(14rem,1fr)_auto] lg:items-end">
        <p className="text-xs text-slate-700" aria-live="polite">
          {totalFiltered === 0
            ? "Không có job khớp bộ lọc."
            : `${pageStart.toLocaleString("vi-VN")}-${pageEnd.toLocaleString(
                "vi-VN",
              )}/${totalFiltered.toLocaleString(
                "vi-VN",
              )} job • Trang ${currentPage.toLocaleString(
                "vi-VN",
              )}/${totalPages.toLocaleString("vi-VN")}.`}
          {selectedCount > 0
            ? ` • ${selectedCount.toLocaleString("vi-VN")} đã chọn`
            : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-400 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            onClick={() => setIsFiltersOpen((open) => !open)}
            aria-expanded={isFiltersOpen}
            aria-controls="scrape-jobs-filters-content"
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            {activeFilterCount.toLocaleString("vi-VN")} bộ lọc
          </button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasActiveViewControls}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={resetViewControls}
          >
            Đặt lại
          </Button>
          <div
            className="inline-flex items-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-0.5"
            role="group"
            aria-label="Kiểu hiển thị"
          >
            <button
              type="button"
              aria-pressed={viewMode === "table"}
              title="Xem dạng bảng"
              onClick={() => setViewMode("table")}
              className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-semibold transition-colors ${
                viewMode === "table"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden />
              Bảng
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "grid"}
              title="Xem dạng lưới"
              onClick={() => setViewMode("grid")}
              className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-semibold transition-colors ${
                viewMode === "grid"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              Lưới
            </button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={viewMode === "grid"}
            leftIcon={
              density === "compact" ? (
                <Rows3 className="h-3.5 w-3.5" />
              ) : (
                <Rows2 className="h-3.5 w-3.5" />
              )
            }
            aria-pressed={density === "compact"}
            onClick={() =>
              setDensity((current) =>
                current === "compact" ? "comfortable" : "compact",
              )
            }
            title={
              density === "compact"
                ? "Đang ở chế độ gọn — bấm để giãn dòng"
                : "Đang ở chế độ thoáng — bấm để thu gọn dòng"
            }
          >
            {density === "compact" ? "Gọn" : "Thoáng"}
          </Button>
          <div ref={columnPickerRef} className="relative">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Columns3 className="h-3.5 w-3.5" />}
              aria-expanded={showColumnPicker}
              aria-controls="scrape-jobs-column-picker"
              onClick={() => setShowColumnPicker((current) => !current)}
            >
              Cột hiển thị
            </Button>
            {showColumnPicker ? (
              <div
                id="scrape-jobs-column-picker"
                className="absolute top-full right-0 z-20 mt-2 w-56 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3 shadow-lg"
              >
                <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
                  Cột tùy chọn
                </p>
                <div className="mt-2 grid gap-2">
                  {scrapeJobColumnOptions.map((column) => {
                    const tableColumn = pageTable.getColumn(column.id);
                    if (!tableColumn?.getCanHide()) {
                      return null;
                    }
                    return (
                      <label
                        key={column.id}
                        className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={tableColumn.getIsVisible()}
                          onChange={tableColumn.getToggleVisibilityHandler()}
                          className="h-4 w-4 rounded border-slate-400 accent-blue-600"
                        />
                        {column.label}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-700">
                  Bấm tiêu đề cột để sắp xếp. Bấm dòng để xem chi tiết job.
                </p>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isFetching}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={onRefresh}
          >
            Làm mới
          </Button>
        </div>
      </div>

      {activeFilterChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold tracking-[0.12em] text-slate-600 uppercase">
            Đang lọc
          </span>
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pr-1.5 pl-2.5 text-xs font-semibold text-blue-800 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              onClick={chip.onClear}
              aria-label={`Bỏ lọc ${chip.label}: ${chip.value}`}
              title={`Bỏ lọc ${chip.label}`}
            >
              <span className="text-blue-500">{chip.label}:</span>
              <span className="max-w-40 truncate">{chip.value}</span>
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            className="ml-1 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:underline"
            onClick={resetViewControls}
          >
            Xóa tất cả
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded border border-slate-400">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-1 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100/80 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          onClick={() => setIsFiltersOpen((open) => !open)}
          aria-expanded={isFiltersOpen}
          aria-controls="scrape-jobs-filters-content"
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal
              className="h-4 w-4 shrink-0 text-slate-700"
              aria-hidden
            />
            <span className="text-sm font-bold text-slate-950">
              Bộ lọc & sắp xếp
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-0.5 text-xs font-semibold text-slate-600">
              {activeFilterCount.toLocaleString("vi-VN")} đang áp dụng
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-700  ${
                isFiltersOpen ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </span>
        </button>

        {isFiltersOpen ? (
          <div
            id="scrape-jobs-filters-content"
            className="grid gap-1 border-t border-slate-400 bg-slate-50 p-3"
          >
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1">
                <span className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
                  Tìm kiếm
                </span>
                <span className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-600"
                    aria-hidden
                  />
                  <input
                    className={`${scrapeJobControlClass} pr-3 pl-9`}
                    placeholder="Host, URL, thông báo"
                    aria-label="Tìm job scrape"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                  />
                </span>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
                  Trạng thái
                </span>
                <select
                  className={scrapeJobControlClass}
                  aria-label="Lọc theo trạng thái"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value as ScrapeJobStatusFilter,
                    )
                  }
                >
                  {scrapeJobStatusFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
                  Cách đọc
                </span>
                <select
                  className={scrapeJobControlClass}
                  aria-label="Lọc theo cách đọc"
                  value={methodFilter}
                  onChange={(event) =>
                    setMethodFilter(
                      event.target.value as ScrapeJobMethodFilter,
                    )
                  }
                >
                  {scrapeJobMethodFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
                  Bổ sung thông tin
                </span>
                <select
                  className={scrapeJobControlClass}
                  aria-label="Lọc theo bổ sung thông tin"
                  value={enrichmentFilter}
                  onChange={(event) =>
                    setEnrichmentFilter(
                      event.target.value as ScrapeJobEnrichmentFilter,
                    )
                  }
                >
                  {scrapeJobEnrichmentFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-400 accent-blue-600"
                  checked={activeOnly}
                  onChange={(event) => setActiveOnly(event.target.checked)}
                />
                Chỉ job đang chạy
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-400 accent-blue-600"
                  checked={hasProductsOnly}
                  onChange={(event) =>
                    setHasProductsOnly(event.target.checked)
                  }
                />
                Chỉ job có sản phẩm
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-400 accent-blue-600"
                  checked={errorOnly}
                  onChange={(event) => setErrorOnly(event.target.checked)}
                />
                Chỉ job lỗi / hủy
              </label>
              <span className="text-xs text-slate-700">
                Bấm tiêu đề cột để đổi thứ tự. Mặc định: job đang chạy lên đầu,
                rồi mới nhất.
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {listCapped ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Danh sách đạt giới hạn {SCRAPE_JOBS_LIST_CAP} job gần nhất. Xóa bớt job
          cũ để xem các job khác.
        </p>
      ) : null}

      {totalFiltered === 0 ? (
        <EmptyState
          title="Không có job khớp bộ lọc."
          description="Thử xóa bớt bộ lọc hoặc đặt lại để xem toàn bộ job."
        />
      ) : (
        <>
          {/* Grid / mobile cards */}
          <div
            className={`grid gap-1 ${
              viewMode === "grid"
                ? "md:grid md:grid-cols-2 xl:grid-cols-3"
                : "md:hidden"
            }`}
            aria-label="Danh sách job dạng thẻ"
          >
            {visibleRows.map((row) => (
              <ScrapeJobCard
                key={row.id}
                job={row.original}
                rowNumber={
                  pagination.pageIndex * pagination.pageSize + row.index + 1
                }
                selected={row.getIsSelected()}
                focused={focusedJobId === row.original.id}
                isStopping={stoppingJobId === row.original.id}
                isDeleting={isDeletingJob}
                onFocus={onFocusJob}
                onStop={onStopJob}
                onDelete={onDeleteJob}
                onToggleSelected={() => row.toggleSelected()}
                clockMs={clockMs}
              />
            ))}
          </div>

          {/* Table */}
          <div
            className={`hidden overflow-hidden rounded border border-slate-400 ${
              viewMode === "table" ? "md:block" : ""
            }`}
          >
            <table className="w-full table-fixed divide-y divide-slate-200 text-sm break-words">
              <thead className="sticky top-0 z-10 border-b border-slate-400 bg-slate-200 text-left text-xs font-bold tracking-wide text-slate-900 uppercase">
                {pageTable.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className={scrapeJobHeaderClass(
                          header.column.id,
                          density,
                        )}
                      >
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
              <tbody className="divide-y divide-slate-100 bg-white">
                {visibleRows.map((row) => {
                  const selected = focusedJobId === row.original.id;
                  return (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      aria-selected={selected}
                      className={`cursor-pointer transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset ${
                        selected
                          ? "bg-blue-50/80"
                          : row.getIsSelected()
                            ? "bg-blue-50/50"
                            : "hover:bg-blue-50/40"
                      }`}
                      onClick={(event) =>
                        handleRowClick(event, row.original.id)
                      }
                      onKeyDown={(event) => {
                        if (event.currentTarget !== event.target) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onFocusJob(row.original.id);
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          data-col={cell.column.id}
                          onClick={
                            cell.column.id === "select"
                              ? (event) => {
                                  event.stopPropagation();
                                  const target =
                                    event.target as HTMLElement;
                                  if (target.closest("input, label")) {
                                    return;
                                  }
                                  if (row.getCanSelect()) {
                                    row.toggleSelected();
                                  }
                                }
                              : undefined
                          }
                          className={scrapeJobCellClass(
                            cell.column.id,
                            density,
                          )}
                        >
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

          {renderPaginationBar()}
        </>
      )}
    </div>
  );
}
