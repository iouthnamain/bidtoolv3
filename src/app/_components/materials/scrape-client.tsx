"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
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
  ArrowUpRight,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Columns3,
  ExternalLink,
  Eye,
  Filter,
  LayoutGrid,
  Link as LinkIcon,
  ListChecks,
  Loader2,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Rows2,
  Rows3,
  Save,
  Search,
  SlidersHorizontal,
  Square,
  StopCircle,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { MatchCompareDrawer } from "~/app/_components/materials/match-compare-drawer";
import { ScrapeProgressBar } from "~/app/_components/materials/scrape-progress-bar";
import { ScrapeProductReviewCard } from "~/app/_components/materials/scrape-product-review-card";
import {
  ACTIVE_CLOCK_MS,
  canImportJob,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_PRODUCTS,
  DEFAULT_PRODUCT_PAGE_SIZE,
  EMPTY_UUID,
  formatDuration,
  formatMoney,
  hostFromUrl,
  IMPORTABLE_SCRAPE_STATUSES,
  isImportJobActive,
  isJobActive,
  isNotFoundTRPCError,
  IMPORT_POLL_MS,
  JOB_LIST_POLL_MS,
  MAX_PAGE_LIMIT,
  MAX_PRODUCT_LIMIT,
  productKey,
  progressPercent,
  readStoredJobId,
  SCRAPE_JOBS_LIST_CAP,
  SCRAPE_POLL_MS,
  SHOP_JOB_CACHE_MS,
  SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY,
  shortJobId,
  writeStoredJobId,
  type DetailEnrichmentMode,
  type ImportJob,
  type ImportShopItem,
  type ScrapeJob,
  type ScrapeJobListItem,
  type ScrapeMethod,
  type ScrapeMode,
  type ScrapedProduct,
} from "~/app/_components/materials/scrape-job-utils";
import {
  loadColumnVisibility as loadColumnVisibilityShared,
  loadDensity as loadDensityShared,
  loadViewMode as loadViewModeShared,
  SelectionCheckbox,
  SortableHeader,
  tableCellClass,
  tableHeaderClass,
  type SortOrder,
  type TableDensity,
  type ViewMode,
} from "~/app/_components/materials/list-table-helpers";
import { useToast } from "~/app/_components/ui/toast";
import { sanitizeScrapedProductList } from "~/lib/materials/shop-promo-badges";
import {
  matchesQualityFilter,
  qualityFlags,
  SCRAPE_QUALITY_FLAG_LABELS,
  type ScrapeProductQualityFilter,
  type ScrapeQualityFlag,
} from "~/lib/materials/scrape-product-quality";
import { api } from "~/trpc/react";

type PendingScrapeJob = {
  url: string;
  scrapeMode: ScrapeMode;
  maxPages: number | null;
  maxProducts: number | null;
  method: ScrapeMethod;
  detailEnrichment: DetailEnrichmentMode;
  startedAt: number;
};

const SCRAPE_QUALITY_FILTER_OPTIONS: ScrapeQualityFlag[] = [
  "missingPrice",
  "missingNcc",
  "missingOrigin",
  "missingSpec",
  "suspiciousName",
  "hasPdf",
];

const scrapeModeLabel: Record<ScrapeMode, string> = {
  limited: "Giới hạn",
  all: "Scrape hết",
};

const scrapeMethodLabel: Record<ScrapeMethod, string> = {
  auto: "Tự động",
  json_ld: "JSON-LD",
  dom_cards: "DOM cards",
};

const scrapeMethodHelp: Record<ScrapeMethod, string> = {
  auto: "Dùng dữ liệu có cấu trúc trước, bổ sung bằng thẻ sản phẩm.",
  json_ld: "Chỉ đọc schema Product/ItemList trong JSON-LD.",
  dom_cards: "Chỉ đọc các card sản phẩm hiển thị trên trang.",
};

const detailEnrichmentLabel: Record<DetailEnrichmentMode, string> = {
  none: "Không đọc chi tiết",
  missing_fields: "Bổ sung thiếu",
};

const detailEnrichmentHelp: Record<DetailEnrichmentMode, string> = {
  none: "Nhanh hơn, chỉ lấy dữ liệu trên trang danh mục.",
  missing_fields:
    "Chậm hơn nhưng mở trang sản phẩm để tìm NCC, xuất xứ, thông số và nhóm còn thiếu.",
};

const actionTone: Record<
  ImportShopItem["action"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  created: "success",
  updated: "info",
  skipped: "neutral",
  failed: "critical",
};

const actionLabel: Record<ImportShopItem["action"], string> = {
  created: "Tạo mới",
  updated: "Cập nhật",
  skipped: "Bỏ qua",
  failed: "Lỗi",
};

const statusLabel: Record<ScrapeJob["status"], string> = {
  queued: "Đang xếp hàng",
  running: "Đang scrape",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

const statusTone: Record<
  ScrapeJob["status"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

const stopReasonLabel: Record<NonNullable<ScrapeJob["stopReason"]>, string> = {
  queue_empty: "Đã đọc hết queue",
  page_limit: "Đạt giới hạn trang",
  product_limit: "Đạt giới hạn sản phẩm",
  timeout: "Quá thời gian",
  cancelled: "Đã hủy",
  error: "Lỗi",
  expired: "Hết hạn",
};

const importStatusLabel: Record<ImportJob["status"], string> = {
  queued: "Đang xếp hàng",
  running: "Đang nhập",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

const importStatusTone: Record<
  ImportJob["status"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function elapsedMsForJob(job: ScrapeJobListItem, nowMs: number) {
  if (job.durationMs != null) {
    return job.durationMs;
  }

  const startedAtMs = new Date(job.startedAt).getTime();
  const finishedAtMs = job.finishedAt
    ? new Date(job.finishedAt).getTime()
    : nowMs;
  return Math.max(0, finishedAtMs - startedAtMs);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function formatLimit(value: number | null | undefined) {
  return value == null ? "Không giới hạn" : value.toLocaleString("vi-VN");
}

function productDisplayId(jobId: string, index: number) {
  return `${shortJobId(jobId)}-${String(index + 1).padStart(3, "0")}`;
}

function emptyScrapedProduct(jobUrl: string): ScrapedProduct {
  return {
    name: "",
    unit: null,
    category: null,
    specText: "",
    manufacturer: null,
    originCountry: null,
    price: null,
    priceText: null,
    currency: "VND",
    sourceUrl: jobUrl,
    imageUrl: null,
    sku: null,
    model: null,
    availability: null,
    shopCategory: null,
    catalogPdfUrls: [],
  };
}

const scrapeFieldClass =
  "min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none";

function ScrapeProductDetailDialog({
  open,
  job,
  product,
  productIndex,
  originalSourceUrl,
  canEdit,
  isSaving,
  isDeleting,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  job: ScrapeJob;
  product: ScrapedProduct | null;
  productIndex: number | null;
  originalSourceUrl: string | null;
  canEdit: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onChange: (product: ScrapedProduct) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  if (!product) {
    return null;
  }

  const displayId =
    productIndex == null
      ? `Mới · ${shortJobId(job.id)}`
      : productDisplayId(job.id, productIndex);
  const missingLabels = productMissingLabels(product);

  return (
    <dialog
      ref={dialogRef}
      className="fixed top-1/2 left-1/2 z-50 m-0 flex max-h-[min(92dvh,920px)] w-[min(960px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/50"
      aria-labelledby="scrape-product-detail-title"
      aria-describedby="scrape-product-detail-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving && !isDeleting) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !isSaving && !isDeleting) {
          onClose();
        }
      }}
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
              Chi tiết sản phẩm scrape
            </p>
            <h3
              id="scrape-product-detail-title"
              className="mt-1 text-lg font-bold text-slate-950"
            >
              {product.name || "Sản phẩm mới"}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="info">{displayId}</Badge>
              <Badge tone="neutral">Job {shortJobId(job.id)}</Badge>
              <Badge tone="neutral">{hostFromUrl(job.url)}</Badge>
              <Badge tone={statusTone[job.status]}>{statusLabel[job.status]}</Badge>
            </div>
            <p
              id="scrape-product-detail-description"
              className="mt-2 text-xs text-slate-500"
            >
              {scrapeModeLabel[job.scrapeMode]} · {scrapeMethodLabel[job.method]}{" "}
              · {detailEnrichmentLabel[job.detailEnrichment]}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            onClick={onClose}
            aria-label="Đóng chi tiết sản phẩm"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!canEdit ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {job.status === "running" || job.status === "queued"
              ? "Job đang scrape. Bạn có thể xem chi tiết; lưu/xóa sản phẩm sau khi job dừng lại hoặc gặp lỗi."
              : "Job chưa sẵn sàng chỉnh sửa. Bạn có thể xem chi tiết sản phẩm."}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-2">
          {missingLabels.length === 0 ? (
            <Badge tone="success">Đủ thông tin cơ bản</Badge>
          ) : (
            missingLabels.map((label) => (
              <Badge key={label} tone="warning">
                {label}
              </Badge>
            ))
          )}
          {product.catalogPdfUrls.length > 0 ? (
            <Badge tone="info">{product.catalogPdfUrls.length} catalog PDF</Badge>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-bold text-slate-700">Tên sản phẩm</span>
            <input
              className={scrapeFieldClass}
              value={product.name}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({ ...product, name: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-bold text-slate-700">URL nguồn</span>
            <input
              className={scrapeFieldClass}
              type="url"
              spellCheck={false}
              value={product.sourceUrl}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({ ...product, sourceUrl: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Đơn giá</span>
            <input
              className={scrapeFieldClass}
              type="number"
              min={0}
              value={product.price ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  price:
                    event.target.value === ""
                      ? null
                      : Number.parseFloat(event.target.value),
                })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Tiền tệ</span>
            <input
              className={scrapeFieldClass}
              value={product.currency}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({ ...product, currency: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Đơn vị</span>
            <input
              className={scrapeFieldClass}
              value={product.unit ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  unit: event.target.value || null,
                })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Nhóm</span>
            <input
              className={scrapeFieldClass}
              value={product.category ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  category: event.target.value || null,
                })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">NCC</span>
            <input
              className={scrapeFieldClass}
              value={product.manufacturer ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  manufacturer: event.target.value || null,
                })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Xuất xứ</span>
            <input
              className={scrapeFieldClass}
              value={product.originCountry ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  originCountry: event.target.value || null,
                })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">SKU</span>
            <input
              className={scrapeFieldClass}
              spellCheck={false}
              value={product.sku ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({ ...product, sku: event.target.value || null })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Model</span>
            <input
              className={scrapeFieldClass}
              spellCheck={false}
              value={product.model ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({ ...product, model: event.target.value || null })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Nhóm shop</span>
            <input
              className={scrapeFieldClass}
              value={product.shopCategory ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  shopCategory: event.target.value || null,
                })
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-slate-700">Trạng thái</span>
            <input
              className={scrapeFieldClass}
              value={product.availability ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  availability: event.target.value || null,
                })
              }
            />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-bold text-slate-700">Ảnh</span>
            <input
              className={scrapeFieldClass}
              type="url"
              value={product.imageUrl ?? ""}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  imageUrl: event.target.value || null,
                })
              }
            />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-bold text-slate-700">Thông số</span>
            <textarea
              className={`${scrapeFieldClass} min-h-28`}
              value={product.specText}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({ ...product, specText: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-bold text-slate-700">
              Catalog PDF (mỗi dòng một URL)
            </span>
            <textarea
              className={`${scrapeFieldClass} min-h-24 font-mono text-xs`}
              value={product.catalogPdfUrls.join("\n")}
              disabled={!canEdit || isSaving}
              onChange={(event) =>
                onChange({
                  ...product,
                  catalogPdfUrls: event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {product.sourceUrl ? (
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900"
            >
              Mở trang nguồn
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && originalSourceUrl ? (
            <Button
              type="button"
              variant="ghost"
              leftIcon={<Trash2 className="h-4 w-4" />}
              isLoading={isDeleting}
              disabled={isSaving}
              onClick={onDelete}
            >
              Xóa khỏi job
            </Button>
          ) : null}
          <Button type="button" variant="ghost" disabled={isSaving || isDeleting} onClick={onClose}>
            Đóng
          </Button>
          {canEdit ? (
            <Button
              type="button"
              variant="primary"
              leftIcon={<Save className="h-4 w-4" />}
              isLoading={isSaving}
              disabled={isDeleting || !product.name.trim() || !product.sourceUrl.trim()}
              onClick={onSave}
            >
              {originalSourceUrl ? "Lưu thay đổi" : "Thêm sản phẩm"}
            </Button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

function productMissingLabels(product: ScrapedProduct) {
  return [
    product.manufacturer ? null : "Thiếu NCC",
    product.originCountry ? null : "Thiếu xuất xứ",
    product.category ? null : "Thiếu nhóm",
    product.specText.trim() ? null : "Thiếu thông số",
    product.unit ? null : "ĐVT unknown",
  ].filter((label): label is string => Boolean(label));
}

function productInfoSummary(product: ScrapedProduct) {
  return [
    product.sku ? `SKU ${product.sku}` : null,
    product.model ? `Model ${product.model}` : null,
    product.category ? `Nhóm ${product.category}` : null,
    product.availability,
    product.catalogPdfUrls.length > 0
      ? `${product.catalogPdfUrls.length} PDF`
      : null,
  ]
    .filter((label): label is string => Boolean(label))
    .join(" • ");
}

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
      detail: "Preview không còn khả dụng",
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
        label: focused ? "Đang xem preview" : "Preview tạm thời",
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
      label: "Preview lỗi",
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
        <span className="text-[11px] font-medium text-slate-500">
          {formatLimit(job.maxPages)} trang · {formatLimit(job.maxProducts)} SP
        </span>
      ) : (
        <span className="text-[11px] font-medium text-slate-500">
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
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none sm:min-h-10";

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
  { id: "preview", label: "Preview SP" },
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
  stt: "text-center align-top text-slate-500 tabular-nums",
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
          ? "rounded-xl border border-sky-300 bg-sky-50/80 p-3 shadow-[var(--shadow-raised)]"
          : selected
            ? "rounded-xl border border-sky-200 bg-sky-50/50 p-3 shadow-[var(--shadow-raised)]"
            : "rounded-xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-raised)]"
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
          className="min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          onClick={() => onFocus(job.id)}
          aria-current={focused ? "true" : undefined}
          aria-label={`Xem job ${hostFromUrl(job.url)}`}
        >
          <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
            STT {rowNumber.toLocaleString("vi-VN")}
          </span>
          <span className="block truncate text-sm font-semibold text-slate-950">
            {hostFromUrl(job.url)}
          </span>
          <span className="mt-1 line-clamp-2 text-xs break-all text-slate-500">
            {job.url}
          </span>
        </button>
        {active ? (
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-white text-amber-800 transition-colors duration-150 hover:bg-amber-50 hover:text-amber-900 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
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
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-800 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
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
        <p className="mt-1 text-xs font-medium text-slate-500">
          {preview.detail}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-white/80 px-2 py-1.5">
          <dt className="font-semibold text-slate-500">Thời gian</dt>
          <dd className="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {formatDuration(elapsedMsForJob(job, clockMs))}
          </dd>
        </div>
        <div className="rounded-md bg-white/80 px-2 py-1.5">
          <dt className="font-semibold text-slate-500">Hết hạn</dt>
          <dd className="mt-0.5 truncate font-semibold text-slate-900">
            {formatDateTime(job.expiresAt)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function ScrapeJobsList({
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
        header: () => <span className="text-slate-500">STT</span>,
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
            className="block w-full rounded-md text-left focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            onClick={() => onFocusJob(row.original.id)}
            aria-label={`Xem job ${hostFromUrl(row.original.url)}`}
          >
            <span className="block truncate font-semibold text-slate-950 hover:text-sky-700">
              {hostFromUrl(row.original.url)}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-500">
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
        header: "Preview SP",
        cell: ({ row }) => {
          const preview = previewStatusForJob(row.original, {
            focused: focusedJobId === row.original.id,
          });
          return (
            <div>
              <Badge tone={preview.tone}>{preview.label}</Badge>
              {preview.detail ? (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-amber-50 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:opacity-60"
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:opacity-60"
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
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
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
            className="h-10 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 shadow-sm focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none sm:h-8"
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
            className="h-10 w-14 rounded-md border border-slate-300 bg-white px-2 text-center text-xs font-semibold text-slate-800 shadow-sm focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none sm:h-8"
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
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
          aria-label="Trang đầu"
          disabled={pagination.pageIndex === 0}
          onClick={() => goToPage(0)}
        >
          <ChevronsLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
          aria-label="Trang trước"
          disabled={pagination.pageIndex === 0}
          onClick={() => goToPage(pagination.pageIndex - 1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
          aria-label="Trang sau"
          disabled={pagination.pageIndex + 1 >= totalPages}
          onClick={() => goToPage(pagination.pageIndex + 1)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
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
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-sky-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          onClick={resetViewControls}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500">Tổng job</p>
            <ListChecks className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </div>
          <p className="mt-0.5 text-base font-bold text-slate-950">
            {stats.total.toLocaleString("vi-VN")}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
            Bấm để xóa bộ lọc
          </p>
        </button>
        <button
          type="button"
          className={`rounded-lg border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-sky-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${
            activeOnly
              ? "border-sky-400 ring-2 ring-sky-300"
              : "border-sky-200 bg-sky-50/70"
          }`}
          onClick={() => setActiveOnly((current) => !current)}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-sky-700">Đang chạy</p>
            <Loader2 className="h-3.5 w-3.5 text-sky-600" aria-hidden />
          </div>
          <p className="mt-0.5 text-base font-bold text-sky-950 tabular-nums">
            {stats.active.toLocaleString("vi-VN")}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-sky-700">
            Lọc job đang scrape
          </p>
        </button>
        <button
          type="button"
          className={`rounded-lg border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none ${
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
          <p className="mt-0.5 text-[11px] font-medium text-emerald-700">
            Lọc job hoàn tất
          </p>
        </button>
        <button
          type="button"
          className={`rounded-lg border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-violet-200 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none ${
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
          <p className="mt-0.5 text-[11px] font-medium text-violet-700">
            Lọc job có preview SP
          </p>
        </button>
        <button
          type="button"
          className={`rounded-lg border px-2.5 py-2 text-left shadow-sm transition hover:ring-2 hover:ring-amber-200 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none ${
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
          <p className="mt-0.5 text-[11px] font-medium text-amber-700">
            Lọc job lỗi hoặc đã hủy
          </p>
        </button>
      </div>

      <div className="grid gap-3 border-b border-slate-200 pb-3 lg:grid-cols-[minmax(14rem,1fr)_auto] lg:items-end">
        <p className="text-xs text-slate-500" aria-live="polite">
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
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
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
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-0.5 shadow-[var(--shadow-flat)]"
            role="group"
            aria-label="Kiểu hiển thị"
          >
            <button
              type="button"
              aria-pressed={viewMode === "table"}
              title="Xem dạng bảng"
              onClick={() => setViewMode("table")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                viewMode === "table"
                  ? "bg-sky-600 text-white"
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
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                viewMode === "grid"
                  ? "bg-sky-600 text-white"
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
                className="absolute top-full right-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              >
                <p className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
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
                          className="h-4 w-4 rounded border-slate-300 accent-sky-600"
                        />
                        {column.label}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
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
          <span className="text-[11px] font-bold tracking-[0.12em] text-slate-400 uppercase">
            Đang lọc
          </span>
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 py-0.5 pr-1.5 pl-2.5 text-xs font-semibold text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
              onClick={chip.onClear}
              aria-label={`Bỏ lọc ${chip.label}: ${chip.value}`}
              title={`Bỏ lọc ${chip.label}`}
            >
              <span className="text-sky-500">{chip.label}:</span>
              <span className="max-w-40 truncate">{chip.value}</span>
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            className="ml-1 text-xs font-semibold text-slate-500 hover:text-slate-900 hover:underline"
            onClick={resetViewControls}
          >
            Xóa tất cả
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100/80 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          onClick={() => setIsFiltersOpen((open) => !open)}
          aria-expanded={isFiltersOpen}
          aria-controls="scrape-jobs-filters-content"
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal
              className="h-4 w-4 shrink-0 text-slate-500"
              aria-hidden
            />
            <span className="text-sm font-bold text-slate-950">
              Bộ lọc & sắp xếp
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {activeFilterCount.toLocaleString("vi-VN")} đang áp dụng
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-500 transition-transform duration-200 ${
                isFiltersOpen ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </span>
        </button>

        {isFiltersOpen ? (
          <div
            id="scrape-jobs-filters-content"
            className="grid gap-3 border-t border-slate-200 bg-slate-50 p-3"
          >
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Tìm kiếm
                </span>
                <span className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
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
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
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
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
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
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
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
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-sky-600"
                  checked={activeOnly}
                  onChange={(event) => setActiveOnly(event.target.checked)}
                />
                Chỉ job đang chạy
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-sky-600"
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
                  className="h-4 w-4 rounded border-slate-300 accent-sky-600"
                  checked={errorOnly}
                  onChange={(event) => setErrorOnly(event.target.checked)}
                />
                Chỉ job lỗi / hủy
              </label>
              <span className="text-xs text-slate-500">
                Bấm tiêu đề cột để đổi thứ tự. Mặc định: job đang chạy lên đầu,
                rồi mới nhất.
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {listCapped ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
            className={`grid gap-3 ${
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
            className={`hidden overflow-hidden rounded-lg border border-slate-200 ${
              viewMode === "table" ? "md:block" : ""
            }`}
          >
            <table className="w-full table-fixed divide-y divide-slate-200 text-sm break-words">
              <thead className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-slate-100/50 text-left text-xs tracking-wide text-slate-600 uppercase shadow-[0_1px_0_0_rgb(226,232,240)]">
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
                      className={`cursor-pointer transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none focus-visible:ring-inset ${
                        selected
                          ? "bg-sky-50/80"
                          : row.getIsSelected()
                            ? "bg-sky-50/50"
                            : "hover:bg-sky-50/40"
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

export function MaterialScrapeClient({ jobId: routeJobId }: { jobId?: string } = {}) {
  const router = useRouter();
  const isJobPage = routeJobId != null;
  const [shopUrl, setShopUrl] = useState("");
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>("limited");
  const [scrapeMethod, setScrapeMethod] = useState<ScrapeMethod>("auto");
  const [detailEnrichment, setDetailEnrichment] =
    useState<DetailEnrichmentMode>("missing_fields");
  const [maxPages, setMaxPages] = useState(DEFAULT_MAX_PAGES);
  const [maxProducts, setMaxProducts] = useState(DEFAULT_MAX_PRODUCTS);
  const [focusedJobId, setFocusedJobId] = useState<string | null>(
    routeJobId ?? null,
  );
  const [startedJob, setStartedJob] = useState<ScrapeJob | null>(null);
  const [pendingScrapeJob, setPendingScrapeJob] =
    useState<PendingScrapeJob | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [startedImportJob, setStartedImportJob] = useState<ImportJob | null>(
    null,
  );
  const [finalizedScrapeJobId, setFinalizedScrapeJobId] = useState<
    string | null
  >(null);
  const [finalizedImportJobId, setFinalizedImportJobId] = useState<
    string | null
  >(null);
  const [selectedSourceUrls, setSelectedSourceUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailProductKey, setDetailProductKey] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState<ScrapedProduct | null>(null);
  const [detailOriginalSourceUrl, setDetailOriginalSourceUrl] = useState<
    string | null
  >(null);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [deleteProductTarget, setDeleteProductTarget] =
    useState<ScrapedProduct | null>(null);
  const [bulkDeleteSelectedOpen, setBulkDeleteSelectedOpen] = useState(false);
  const [compareProducts, setCompareProducts] = useState<ScrapedProduct[]>([]);
  const [compareIndex, setCompareIndex] = useState(0);
  const [stopJobTarget, setStopJobTarget] = useState<{
    id: string;
    url: string;
  } | null>(null);
  const [deleteJobTarget, setDeleteJobTarget] = useState<{
    id: string;
    url: string;
  } | null>(null);
  const [cancelImportOpen, setCancelImportOpen] = useState(false);
  const [qualityFilter, setQualityFilter] =
    useState<ScrapeProductQualityFilter>("all");
  const [hideMissingNameProducts, setHideMissingNameProducts] = useState(true);
  const [missingJobMessage, setMissingJobMessage] = useState<string | null>(
    null,
  );
  const [productPageIndex, setProductPageIndex] = useState(0);
  const [productPageSize, setProductPageSize] = useState(
    DEFAULT_PRODUCT_PAGE_SIZE,
  );
  const [clockMs, setClockMs] = useState(() => Date.now());
  const utils = api.useUtils();
  const toast = useToast();

  useEffect(() => {
    setMissingJobMessage(null);
    if (routeJobId != null) {
      setFocusedJobId(routeJobId);
    } else {
      const storedJobId = readStoredJobId(SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY);
      setFocusedJobId(storedJobId);
    }
    writeStoredJobId("bidtool:shop-scrape-job:v1", null);
    writeStoredJobId("bidtool:shop-import-job:v1", null);
  }, [routeJobId]);

  useEffect(() => {
    writeStoredJobId(SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY, focusedJobId);
  }, [focusedJobId]);

  const jobListQuery = api.material.listShopScrapeJobs.useQuery(
    { limit: SCRAPE_JOBS_LIST_CAP },
    {
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      return jobs.some(isJobActive) || pendingScrapeJob
        ? JOB_LIST_POLL_MS
        : false;
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: SHOP_JOB_CACHE_MS,
  });

  const focusedListJob =
    jobListQuery.data?.find((job) => job.id === focusedJobId) ?? null;
  const progressSeedJob =
    (startedJob?.id === focusedJobId ? startedJob : null) ?? focusedListJob;
  const shouldPollJobProgress =
    focusedJobId !== null &&
    (pendingScrapeJob !== null || isJobActive(progressSeedJob));

  const jobProgressQuery = api.material.getShopScrapeJobProgress.useQuery(
    { jobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled: shouldPollJobProgress,
      refetchInterval: shouldPollJobProgress ? SCRAPE_POLL_MS : false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );

  const jobQuery = api.material.getShopScrapeJob.useQuery(
    { jobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled:
        focusedJobId !== null &&
        !shouldPollJobProgress &&
        !isJobActive(jobProgressQuery.data),
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const importJobsQuery = api.material.listShopImportJobs.useQuery(
    { scrapeJobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled: focusedJobId !== null,
      refetchInterval: (query) => {
        const jobs = query.state.data ?? [];
        return jobs.some(isImportJobActive) ? JOB_LIST_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const importProgressSeedJob =
    (startedImportJob?.id === importJobId ? startedImportJob : null) ??
    (importJobsQuery.data?.find((job) => job.id === importJobId) ?? null);
  const shouldPollImportProgress =
    importJobId !== null && isImportJobActive(importProgressSeedJob);

  const importJobProgressQuery = api.material.getShopImportJobProgress.useQuery(
    { jobId: importJobId ?? EMPTY_UUID },
    {
      enabled: shouldPollImportProgress,
      refetchInterval: shouldPollImportProgress ? IMPORT_POLL_MS : false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const importJobQuery = api.material.getShopImportJob.useQuery(
    { jobId: importJobId ?? EMPTY_UUID },
    {
      enabled:
        importJobId !== null &&
        !shouldPollImportProgress &&
        !isImportJobActive(importJobProgressQuery.data),
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const activeJob = useMemo(() => {
    const fullJob =
      jobQuery.data ?? (startedJob?.id === focusedJobId ? startedJob : null);
    const progressJob = jobProgressQuery.data;
    if (shouldPollJobProgress && progressJob) {
      return {
        ...progressJob,
        products: fullJob?.products ?? [],
        productsEditable: fullJob?.productsEditable ?? false,
      } as ScrapeJob;
    }
    return fullJob;
  }, [
    focusedJobId,
    jobProgressQuery.data,
    jobQuery.data,
    shouldPollJobProgress,
    startedJob,
  ]);
  const activeImportJob = useMemo(() => {
    const fullJob =
      importJobQuery.data ??
      (startedImportJob?.id === importJobId ? startedImportJob : null);
    const progressJob = importJobProgressQuery.data;
    if (shouldPollImportProgress && progressJob) {
      return {
        ...progressJob,
        items: fullJob?.items ?? [],
      } as ImportJob;
    }
    return fullJob;
  }, [
    importJobId,
    importJobProgressQuery.data,
    importJobQuery.data,
    shouldPollImportProgress,
    startedImportJob,
  ]);
  const jobRows = jobListQuery.data ?? [];
  const hasActiveListJob = jobRows.some(isJobActive);
  const isActive = isJobActive(activeJob);
  const isImportActive = isImportJobActive(activeImportJob);
  const isStartingScrape = !!pendingScrapeJob;
  const canStart = shopUrl.trim().length > 0 && !isStartingScrape;
  const selectedCount = selectedSourceUrls.size;
  const scrapeProducts = useMemo(
    () => sanitizeScrapedProductList(activeJob?.products ?? []),
    [activeJob?.products],
  );
  const filteredScrapeProducts = useMemo(
    () =>
      scrapeProducts.filter((product) =>
        matchesQualityFilter(product, qualityFilter, {
          hideMissingName: hideMissingNameProducts,
        }),
      ),
    [hideMissingNameProducts, qualityFilter, scrapeProducts],
  );
  const productPageCount = Math.max(
    1,
    Math.ceil(filteredScrapeProducts.length / productPageSize),
  );
  const pagedScrapeProducts = useMemo(() => {
    const start = productPageIndex * productPageSize;
    return filteredScrapeProducts.slice(start, start + productPageSize);
  }, [filteredScrapeProducts, productPageIndex, productPageSize]);
  const isPartialImportableJob =
    !!activeJob &&
    (activeJob.status === "failed" || activeJob.status === "cancelled") &&
    activeJob.productCount > 0 &&
    !activeJob.isExpired;
  const allProductKeys = useMemo(
    () => new Set(scrapeProducts.map(productKey)),
    [scrapeProducts],
  );
  const filteredProductKeys = useMemo(
    () => new Set(filteredScrapeProducts.map(productKey)),
    [filteredScrapeProducts],
  );
  const allSelected =
    filteredProductKeys.size > 0 &&
    Array.from(filteredProductKeys).every((key) => selectedSourceUrls.has(key));
  const canImportSelected =
    canImportJob(activeJob) && selectedCount > 0 && !isImportActive;
  const canImportAll = canImportJob(activeJob) && !isImportActive;
  const canEditScrapeProducts =
    !!activeJob && activeJob.productsEditable && !isImportActive;
  const canDeleteSelected = canEditScrapeProducts && selectedCount > 0;
  const detailProductIndex =
    activeJob && detailProductKey
      ? scrapeProducts.findIndex(
          (product) => productKey(product) === detailProductKey,
        )
      : -1;
  const scrapeJobPollingError =
    (jobProgressQuery.isError && !isNotFoundTRPCError(jobProgressQuery.error)
      ? (jobProgressQuery.error.message ?? "Không cập nhật được tiến độ scrape.")
      : null) ??
    (jobQuery.isError && !isNotFoundTRPCError(jobQuery.error)
      ? (jobQuery.error.message ?? "Không cập nhật được tiến độ scrape.")
      : null);
  const isJobDetailLoading =
    isJobPage &&
    missingJobMessage == null &&
    focusedJobId !== null &&
    !activeJob &&
    (jobQuery.isLoading || jobProgressQuery.isLoading);
  const importJobPollingError =
    (importJobProgressQuery.isError &&
    !isNotFoundTRPCError(importJobProgressQuery.error)
      ? (importJobProgressQuery.error.message ??
        "Không cập nhật được tiến độ nhập catalog.")
      : null) ??
    (importJobQuery.isError && !isNotFoundTRPCError(importJobQuery.error)
      ? (importJobQuery.error.message ??
        "Không cập nhật được tiến độ nhập catalog.")
      : null);

  useEffect(() => {
    const progress = jobProgressQuery.data;
    if (!focusedJobId || !progress || isJobActive(progress)) {
      return;
    }
    void jobQuery.refetch();
  }, [focusedJobId, jobProgressQuery.data, jobQuery]);

  useEffect(() => {
    const progress = importJobProgressQuery.data;
    if (!importJobId || !progress || isImportJobActive(progress)) {
      return;
    }
    void importJobQuery.refetch();
  }, [importJobId, importJobProgressQuery.data, importJobQuery]);

  useEffect(() => {
    setProductPageIndex(0);
  }, [qualityFilter, hideMissingNameProducts, activeJob?.id]);

  useEffect(() => {
    if (productPageIndex + 1 > productPageCount) {
      setProductPageIndex(Math.max(0, productPageCount - 1));
    }
  }, [productPageCount, productPageIndex]);

  useEffect(() => {
    const latestImportJob = importJobsQuery.data?.[0] ?? null;
    if (!latestImportJob) {
      if (startedImportJob?.scrapeJobId !== focusedJobId) {
        setImportJobId(null);
        setStartedImportJob(null);
      }
      return;
    }

    if (latestImportJob.scrapeJobId === focusedJobId) {
      const importJobIds = new Set(
        (importJobsQuery.data ?? []).map((job) => job.id),
      );
      setImportJobId((current) =>
        current && importJobIds.has(current) ? current : latestImportJob.id,
      );
    }
  }, [focusedJobId, importJobsQuery.data, startedImportJob]);

  useEffect(() => {
    if (
      !pendingScrapeJob &&
      !isActive &&
      !isImportActive &&
      !hasActiveListJob
    ) {
      return;
    }

    const timerId = window.setInterval(
      () => setClockMs(Date.now()),
      ACTIVE_CLOCK_MS,
    );
    return () => window.clearInterval(timerId);
  }, [pendingScrapeJob, isActive, isImportActive, hasActiveListJob]);

  useEffect(() => {
    setSelectedSourceUrls((previous) => {
      if (previous.size === 0) {
        return previous;
      }
      const next = new Set<string>();
      for (const key of previous) {
        if (allProductKeys.has(key)) {
          next.add(key);
        }
      }
      return next.size === previous.size ? previous : next;
    });
  }, [allProductKeys]);

  useEffect(() => {
    if (
      !focusedJobId ||
      !jobQuery.isError ||
      !isNotFoundTRPCError(jobQuery.error)
    ) {
      return;
    }

    const message = "Không tìm thấy job scrape shop hoặc job đã hết hạn.";
    if (isJobPage) {
      setMissingJobMessage(message);
      setFocusedJobId(null);
      setStartedJob(null);
      setPendingScrapeJob(null);
      setFinalizedScrapeJobId(null);
      setSelectedSourceUrls(new Set());
      return;
    }

    setFocusedJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setFinalizedScrapeJobId(null);
    setSelectedSourceUrls(new Set());
    toast.warning("Job scrape đã hết hạn trên server, đã xóa trạng thái cũ.");
  }, [focusedJobId, isJobPage, jobQuery.error, jobQuery.isError, toast]);

  useEffect(() => {
    const job = jobQuery.data;
    if (!focusedJobId || !job?.isExpired) {
      return;
    }

    const message = job.error ?? "Job scrape đã hết hạn trên server.";
    if (isJobPage) {
      setMissingJobMessage(message);
      setFocusedJobId(null);
      setStartedJob(null);
      setPendingScrapeJob(null);
      setFinalizedScrapeJobId(null);
      setSelectedSourceUrls(new Set());
      return;
    }

    setFocusedJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setFinalizedScrapeJobId(null);
    setSelectedSourceUrls(new Set());
    toast.warning(message);
  }, [focusedJobId, isJobPage, jobQuery.data, toast]);

  useEffect(() => {
    if (
      !importJobId ||
      !importJobQuery.isError ||
      !isNotFoundTRPCError(importJobQuery.error)
    ) {
      return;
    }

    setImportJobId(null);
    setStartedImportJob(null);
    setFinalizedImportJobId(null);
    toast.warning(
      "Job nhập catalog đã hết hạn trên server, đã xóa trạng thái cũ.",
    );
  }, [importJobId, importJobQuery.error, importJobQuery.isError, toast]);

  const startShopScrapeJob = api.material.startShopScrapeJob.useMutation({
    onSuccess: (job) => {
      setStartedJob(job);
      setFocusedJobId(job.id);
      setPendingScrapeJob(null);
      setStartedImportJob(null);
      setImportJobId(null);
      setFinalizedScrapeJobId(null);
      setFinalizedImportJobId(null);
      setSelectedSourceUrls(new Set());
      utils.material.getShopScrapeJob.setData({ jobId: job.id }, job);
      void utils.material.listShopScrapeJobs.invalidate();
      router.push(`/materials/scrape/jobs/${job.id}`);
      toast.success("Đã bắt đầu job scrape shop.");
    },
    onError: (error) => {
      setPendingScrapeJob(null);
      toast.error(error.message || "Không thể bắt đầu scrape shop.");
    },
  });

  const cancelShopScrapeJob = api.material.cancelShopScrapeJob.useMutation({
    onSuccess: (job) => {
      setStartedJob(job);
      utils.material.getShopScrapeJob.setData({ jobId: job.id }, job);
      void utils.material.listShopScrapeJobs.invalidate();
      toast.warning("Đã hủy job scrape shop.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể hủy job scrape shop.");
    },
  });

  const syncFocusedScrapeJob = (job: ScrapeJob) => {
    utils.material.getShopScrapeJob.setData({ jobId: job.id }, job);
    if (focusedJobId === job.id) {
      setStartedJob(job);
    }
    void utils.material.listShopScrapeJobs.invalidate();
  };

  const updateShopScrapeJobProduct =
    api.material.updateShopScrapeJobProduct.useMutation({
      onSuccess: (job) => {
        syncFocusedScrapeJob(job);
        if (detailOriginalSourceUrl) {
          setSelectedSourceUrls((previous) => {
            if (!previous.has(detailOriginalSourceUrl)) {
              return previous;
            }
            const next = new Set(previous);
            next.delete(detailOriginalSourceUrl);
            if (detailDraft) {
              next.add(detailDraft.sourceUrl);
            }
            return next;
          });
        }
        closeProductDetail();
        toast.success("Đã lưu sản phẩm scrape.");
      },
      onError: (error) => {
        toast.error(error.message || "Không thể lưu sản phẩm scrape.");
      },
    });

  const deleteShopScrapeJobProduct =
    api.material.deleteShopScrapeJobProduct.useMutation({
      onSuccess: (job) => {
        syncFocusedScrapeJob(job);
        if (deleteProductTarget) {
          setSelectedSourceUrls((previous) => {
            if (!previous.has(deleteProductTarget.sourceUrl)) {
              return previous;
            }
            const next = new Set(previous);
            next.delete(deleteProductTarget.sourceUrl);
            return next;
          });
        }
        setDeleteProductTarget(null);
        closeProductDetail();
        toast.success("Đã xóa sản phẩm khỏi job scrape.");
      },
      onError: (error) => {
        toast.error(error.message || "Không thể xóa sản phẩm scrape.");
      },
    });

  const deleteShopScrapeJobProducts =
    api.material.deleteShopScrapeJobProducts.useMutation({
      onSuccess: ({ job, removedCount }) => {
        syncFocusedScrapeJob(job);
        setSelectedSourceUrls(new Set());
        setBulkDeleteSelectedOpen(false);
        closeProductDetail();
        toast.success(
          `Đã xóa ${removedCount.toLocaleString("vi-VN")} sản phẩm khỏi preview.`,
        );
      },
      onError: (error) => {
        toast.error(error.message || "Không thể xóa các sản phẩm đã chọn.");
      },
    });

  const addShopScrapeJobProduct = api.material.addShopScrapeJobProduct.useMutation(
    {
      onSuccess: (job) => {
        syncFocusedScrapeJob(job);
        closeProductDetail();
        toast.success("Đã thêm sản phẩm vào job scrape.");
      },
      onError: (error) => {
        toast.error(error.message || "Không thể thêm sản phẩm scrape.");
      },
    },
  );

  const deleteShopScrapeJob = api.material.deleteShopScrapeJob.useMutation({
    onSuccess: (job) => {
      if (focusedJobId === job.id) {
        setFocusedJobId(null);
        setStartedJob(null);
        setImportJobId(null);
        setStartedImportJob(null);
        setSelectedSourceUrls(new Set());
      }
      void utils.material.listShopScrapeJobs.invalidate();
      toast.success("Đã xóa job khỏi danh sách.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể xóa job scrape shop.");
    },
  });

  const startShopImportJob = api.material.startShopImportJob.useMutation({
    onSuccess: (job) => {
      setStartedImportJob(job);
      setImportJobId(job.id);
      setFinalizedImportJobId(null);
      utils.material.getShopImportJob.setData({ jobId: job.id }, job);
      void utils.material.listShopImportJobs.invalidate();
      toast.success("Đã bắt đầu job nhập catalog.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể bắt đầu nhập catalog.");
    },
  });

  const cancelShopImportJob = api.material.cancelShopImportJob.useMutation({
    onSuccess: (job) => {
      setStartedImportJob(job);
      utils.material.getShopImportJob.setData({ jobId: job.id }, job);
      void utils.material.listShopImportJobs.invalidate();
      toast.warning("Đã hủy job nhập catalog.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể hủy job nhập catalog.");
    },
  });

  useEffect(() => {
    const job = activeImportJob;
    if (!job || isImportJobActive(job) || finalizedImportJobId === job.id) {
      return;
    }

    setFinalizedImportJobId(job.id);
    if (job.items.length > 0) {
      void Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
    }

    if (job.status === "completed") {
      toast.success(
        `Đã nhập ${job.created + job.updated} sản phẩm vào catalog.`,
      );
    } else if (job.status === "failed") {
      toast.error(job.error ?? "Job nhập catalog đã lỗi.");
    } else if (job.status === "cancelled") {
      toast.warning(
        `Đã dừng nhập catalog sau ${job.processed.toLocaleString(
          "vi-VN",
        )}/${job.total.toLocaleString("vi-VN")} sản phẩm.`,
      );
    }
    void utils.material.listShopImportJobs.invalidate();
  }, [activeImportJob, finalizedImportJobId, toast, utils.material]);

  useEffect(() => {
    const job = activeJob;
    if (
      !job ||
      job.isExpired ||
      isJobActive(job) ||
      finalizedScrapeJobId === job.id
    ) {
      return;
    }

    setFinalizedScrapeJobId(job.id);
    if (job.status === "completed") {
      toast.success(
        job.message ??
          `Đã scrape ${job.productCount.toLocaleString("vi-VN")} sản phẩm.`,
      );
    } else if (job.status === "failed") {
      toast.error(job.error ?? "Job scrape shop đã lỗi.");
    } else if (job.status === "cancelled") {
      toast.warning(job.message ?? "Job scrape shop đã bị hủy.");
    }
    void utils.material.listShopScrapeJobs.invalidate();
  }, [activeJob, finalizedScrapeJobId, toast, utils.material]);

  const startScrape = (url = shopUrl.trim()) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl || isStartingScrape) {
      return;
    }
    setShopUrl(normalizedUrl);
    setStartedJob(null);
    setFocusedJobId(null);
    setPendingScrapeJob({
      url: normalizedUrl,
      scrapeMode,
      maxPages: scrapeMode === "all" ? null : maxPages,
      maxProducts: scrapeMode === "all" ? null : maxProducts,
      method: scrapeMethod,
      detailEnrichment,
      startedAt: Date.now(),
    });
    setClockMs(Date.now());
    setStartedImportJob(null);
    setImportJobId(null);
    setFinalizedScrapeJobId(null);
    setFinalizedImportJobId(null);
    setSelectedSourceUrls(new Set());
    startShopScrapeJob.mutate({
      url: normalizedUrl,
      scrapeMode,
      maxPages: scrapeMode === "all" ? null : maxPages,
      maxProducts: scrapeMode === "all" ? null : maxProducts,
      method: scrapeMethod,
      detailEnrichment,
    });
  };

  const closeProductDetail = () => {
    setDetailProductKey(null);
    setDetailDraft(null);
    setDetailOriginalSourceUrl(null);
    setIsCreatingProduct(false);
  };

  const openProductDetail = (product: ScrapedProduct) => {
    setIsCreatingProduct(false);
    setDetailProductKey(productKey(product));
    setDetailOriginalSourceUrl(product.sourceUrl);
    setDetailDraft({ ...product });
  };

  const openCreateProductDetail = () => {
    if (!activeJob || !canEditScrapeProducts) {
      return;
    }
    const draft = emptyScrapedProduct(activeJob.url);
    setIsCreatingProduct(true);
    setDetailProductKey("__new__");
    setDetailOriginalSourceUrl(null);
    setDetailDraft(draft);
  };

  const saveProductDetail = () => {
    if (!activeJob || !detailDraft || !canEditScrapeProducts) {
      return;
    }
    if (isCreatingProduct || !detailOriginalSourceUrl) {
      addShopScrapeJobProduct.mutate({
        jobId: activeJob.id,
        product: detailDraft,
      });
      return;
    }
    updateShopScrapeJobProduct.mutate({
      jobId: activeJob.id,
      sourceUrl: detailOriginalSourceUrl,
      product: detailDraft,
    });
  };

  const focusScrapeJob = (jobId: string) => {
    if (!isJobPage) {
      router.push(`/materials/scrape/jobs/${jobId}`);
      return;
    }
    closeProductDetail();
    setFocusedJobId(jobId);
    setStartedJob(null);
    setSelectedSourceUrls(new Set());
  };

  const stopScrapeJob = (job: { id: string; url: string }) => {
    if (cancelShopScrapeJob.isPending) {
      return;
    }
    setStopJobTarget(job);
  };

  const deleteScrapeJob = (job: { id: string; url: string }) => {
    if (deleteShopScrapeJob.isPending) {
      return;
    }
    setDeleteJobTarget(job);
  };

  const confirmStopScrapeJob = () => {
    if (!stopJobTarget) {
      return;
    }
    focusScrapeJob(stopJobTarget.id);
    cancelShopScrapeJob.mutate({ jobId: stopJobTarget.id });
    setStopJobTarget(null);
  };

  const confirmDeleteScrapeJob = () => {
    if (!deleteJobTarget) {
      return;
    }
    deleteShopScrapeJob.mutate({ jobId: deleteJobTarget.id });
    setDeleteJobTarget(null);
  };

  const downloadScrapeCsv = async () => {
    if (!activeJob) {
      return;
    }
    try {
      const result = await utils.material.exportShopScrapeJobCsv.fetch({
        jobId: activeJob.id,
      });
      const blob = new Blob([result.csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `scrape-${shortJobId(activeJob.id)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Đã tải CSV preview (${result.count.toLocaleString("vi-VN")} sản phẩm).`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Không thể xuất CSV preview scrape.",
      );
    }
  };

  const submitScrape = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canStart) {
      startScrape();
    }
  };

  const isScrapeAll = scrapeMode === "all";
  const isAutoMethod = scrapeMethod === "auto";
  const showLimitFields = !isScrapeAll;

  const toggleProduct = (product: ScrapedProduct) => {
    const key = productKey(product);
    setSelectedSourceUrls((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllProducts = () => {
    setSelectedSourceUrls((previous) => {
      const next = new Set(previous);
      if (allSelected) {
        for (const key of filteredProductKeys) {
          next.delete(key);
        }
      } else {
        for (const key of filteredProductKeys) {
          next.add(key);
        }
      }
      return next;
    });
  };

  const importAll = () => {
    if (!activeJob || !canImportAll) {
      return;
    }
    startShopImportJob.mutate({ scrapeJobId: activeJob.id });
  };

  const importSelected = () => {
    if (!activeJob || !canImportSelected) {
      return;
    }
    startShopImportJob.mutate({
      scrapeJobId: activeJob.id,
      productSourceUrls: Array.from(selectedSourceUrls),
    });
  };

  const resetJob = () => {
    if (isStartingScrape) {
      return;
    }
    closeProductDetail();
    if (isJobPage) {
      router.push("/materials/scrape");
      return;
    }
    setFocusedJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setImportJobId(null);
    setStartedImportJob(null);
    setFinalizedImportJobId(null);
    setFinalizedScrapeJobId(null);
    setSelectedSourceUrls(new Set());
  };

  const pagePercent = activeJob
    ? progressPercent(activeJob.pagesVisited.length, activeJob.maxPages)
    : null;
  const productPercent = activeJob
    ? progressPercent(activeJob.productCount, activeJob.maxProducts)
    : null;
  const importPercent = activeImportJob
    ? progressPercent(activeImportJob.processed, activeImportJob.total)
    : null;
  const activeJobStopReason = activeJob?.stopReason
    ? stopReasonLabel[activeJob.stopReason]
    : null;
  const activeJobMessage =
    activeJob?.message ?? activeJob?.error ?? activeJobStopReason;
  const importResult =
    activeImportJob &&
    !isImportJobActive(activeImportJob) &&
    activeImportJob.items.length > 0
      ? activeImportJob
      : null;
  const pendingScrapeDurationMs = pendingScrapeJob
    ? clockMs - pendingScrapeJob.startedAt
    : null;

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={stopJobTarget !== null}
        title={`Dừng job scrape ${stopJobTarget ? hostFromUrl(stopJobTarget.url) : ""}?`}
        description="Job sẽ dừng ngay. Các sản phẩm đã thu thập vẫn giữ trong preview."
        confirmLabel="Dừng job"
        variant="danger"
        isLoading={cancelShopScrapeJob.isPending}
        onConfirm={confirmStopScrapeJob}
        onCancel={() => setStopJobTarget(null)}
      />
      <ConfirmDialog
        open={deleteJobTarget !== null}
        title={`Xóa job scrape ${deleteJobTarget ? hostFromUrl(deleteJobTarget.url) : ""}?`}
        description="Job sẽ bị gỡ khỏi danh sách. Preview sản phẩm không còn khả dụng."
        confirmLabel="Xóa job"
        variant="danger"
        isLoading={deleteShopScrapeJob.isPending}
        onConfirm={confirmDeleteScrapeJob}
        onCancel={() => setDeleteJobTarget(null)}
      />
      <ConfirmDialog
        open={cancelImportOpen}
        title="Hủy job nhập catalog?"
        description="Tiến trình ghi DB sẽ dừng. Các dòng đã ghi vẫn giữ trong catalog."
        confirmLabel="Hủy nhập"
        variant="danger"
        isLoading={cancelShopImportJob.isPending}
        onConfirm={() => {
          if (!activeImportJob) {
            return;
          }
          cancelShopImportJob.mutate({ jobId: activeImportJob.id });
          setCancelImportOpen(false);
        }}
        onCancel={() => setCancelImportOpen(false)}
      />
      {isJobPage ? (
        <section className="panel p-4 sm:p-5">
          <Link
            href="/materials/scrape"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Quay lại danh sách job
          </Link>
        </section>
      ) : null}

      {!isJobPage ? (
      <>
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-violet-700" aria-hidden />
            <h2 className="text-sm font-bold text-slate-950">Cấu hình job scrape</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Job chạy nền trên server, theo pagination cùng domain và chỉ nhập
            vào catalog sau khi bạn duyệt sản phẩm.
          </p>
        </div>

        <form onSubmit={submitScrape} className="space-y-4 p-4 sm:p-5">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
              Shop URL
            </span>
            <span className="relative">
              <LinkIcon
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                placeholder="https://shop.example.com/category"
                spellCheck={false}
                value={shopUrl}
                disabled={isStartingScrape}
                onChange={(event) => setShopUrl(event.target.value)}
                aria-label="URL shop để scrape sản phẩm"
              />
            </span>
          </label>

          <div className="grid gap-4 lg:grid-cols-3">
            <fieldset className="grid gap-1.5">
              <legend className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                Phạm vi
              </legend>
              <div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-slate-50 p-0.5">
                {(["limited", "all"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={
                      scrapeMode === mode
                        ? "min-h-10 rounded-md bg-white px-2 text-xs font-bold text-sky-800 shadow-sm sm:min-h-8"
                        : "min-h-10 rounded-md px-2 text-xs font-semibold text-slate-600 hover:text-slate-900 sm:min-h-8"
                    }
                    disabled={isStartingScrape}
                    onClick={() => setScrapeMode(mode)}
                    aria-pressed={scrapeMode === mode}
                  >
                    {scrapeModeLabel[mode]}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                Cách đọc
              </span>
              <select
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none sm:min-h-9"
                value={scrapeMethod}
                disabled={isStartingScrape}
                onChange={(event) =>
                  setScrapeMethod(event.target.value as ScrapeMethod)
                }
                aria-label="Phương thức scrape sản phẩm"
              >
                {(["auto", "json_ld", "dom_cards"] as const).map((method) => (
                  <option key={method} value={method}>
                    {scrapeMethodLabel[method]}
                  </option>
                ))}
              </select>
              {!isAutoMethod ? (
                <span className="text-xs text-slate-500">
                  {scrapeMethodHelp[scrapeMethod]}
                </span>
              ) : null}
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                Bổ sung thông tin
              </span>
              <select
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none sm:min-h-9"
                value={detailEnrichment}
                disabled={isStartingScrape}
                onChange={(event) =>
                  setDetailEnrichment(
                    event.target.value as DetailEnrichmentMode,
                  )
                }
                aria-label="Bổ sung dữ liệu từ trang chi tiết sản phẩm"
              >
                {(["none", "missing_fields"] as const).map((mode) => (
                  <option key={mode} value={mode}>
                    {detailEnrichmentLabel[mode]}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">
                {detailEnrichmentHelp[detailEnrichment]}
              </span>
            </label>
          </div>

          {showLimitFields ? (
            <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Trang tối đa
                </span>
                <input
                  type="number"
                  name="maxPages"
                  min={1}
                  max={MAX_PAGE_LIMIT}
                  step={1}
                  inputMode="numeric"
                  autoComplete="off"
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none sm:min-h-9"
                  value={maxPages}
                  disabled={isStartingScrape}
                  onChange={(event) =>
                    setMaxPages(
                      clampNumber(
                        Number(event.target.value),
                        1,
                        MAX_PAGE_LIMIT,
                      ),
                    )
                  }
                  aria-label="Số trang tối đa cần scrape"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Sản phẩm tối đa
                </span>
                <input
                  type="number"
                  name="maxProducts"
                  min={1}
                  max={MAX_PRODUCT_LIMIT}
                  step={1}
                  inputMode="numeric"
                  autoComplete="off"
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none sm:min-h-9"
                  value={maxProducts}
                  disabled={isStartingScrape}
                  onChange={(event) =>
                    setMaxProducts(
                      clampNumber(
                        Number(event.target.value),
                        1,
                        MAX_PRODUCT_LIMIT,
                      ),
                    )
                  }
                  aria-label="Số sản phẩm tối đa cần scrape"
                />
              </label>
            </div>
          ) : null}

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={!canStart}
                isLoading={isStartingScrape}
                leftIcon={<Search className="h-4 w-4" />}
              >
                {isStartingScrape ? "Đang khởi động" : "Bắt đầu scrape"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!isActive || !activeJob}
                isLoading={cancelShopScrapeJob.isPending}
                leftIcon={<StopCircle className="h-4 w-4" />}
                onClick={() => {
                  if (activeJob) {
                    stopScrapeJob(activeJob);
                  }
                }}
              >
                Dừng job
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isStartingScrape}
                leftIcon={<RotateCcw className="h-4 w-4" />}
                onClick={resetJob}
              >
                Bỏ chọn job
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 px-3 py-2">
              <Badge tone="neutral">Theo pagination cùng domain</Badge>
              <Badge tone="neutral">Chặn ảnh / font / media</Badge>
              <Badge tone="neutral">Nhập sau khi duyệt</Badge>
              {detailEnrichment === "none" ? (
                <Badge tone="warning">NCC / xuất xứ có thể thiếu</Badge>
              ) : null}
              {isAutoMethod ? (
                <Badge tone="info">Tự động: JSON-LD + DOM cards</Badge>
              ) : null}
              {isScrapeAll ? (
                <Badge tone="info">
                  Scrape hết — áp giới hạn an toàn 100 trang / 2.000 sản phẩm
                </Badge>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-title">Danh sách job</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Nhiều scrape chạy song song
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Mỗi job giữ cấu hình scrape đã chọn, trạng thái chạy và preview
              sản phẩm. Chọn một job để xem và nhập catalog.
            </p>
          </div>
        </div>

        {jobRows.length > 0 ? (
          <ScrapeJobsList
            jobRows={jobRows}
            focusedJobId={focusedJobId}
            clockMs={clockMs}
            isFetching={jobListQuery.isFetching}
            onRefresh={() => void jobListQuery.refetch()}
            onFocusJob={focusScrapeJob}
            onStopJob={stopScrapeJob}
            onDeleteJob={deleteScrapeJob}
            stoppingJobId={
              cancelShopScrapeJob.isPending
                ? (cancelShopScrapeJob.variables?.jobId ?? null)
                : null
            }
            isDeletingJob={deleteShopScrapeJob.isPending}
          />
        ) : (
          <EmptyState
            className="mt-4"
            title="Chưa có job scrape."
            description="Nhập URL shop để tạo job mới. Danh sách này được đọc lại từ Postgres."
          />
        )}
      </section>
      </>
      ) : null}

      {!isJobPage ? null : (
        <>
      {scrapeJobPollingError ? (
        <section className="panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>Không cập nhật được tiến độ scrape: {scrapeJobPollingError}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void jobQuery.refetch()}
            >
              Thử lại
            </Button>
          </div>
        </section>
      ) : null}

      {importJobPollingError ? (
        <section className="panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              Không cập nhật được tiến độ nhập catalog: {importJobPollingError}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void importJobQuery.refetch()}
            >
              Thử lại
            </Button>
          </div>
        </section>
      ) : null}

      {missingJobMessage ? (
        <section className="panel border-amber-200 bg-amber-50 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title text-amber-800">Không mở được job</p>
              <h2 className="mt-1 text-base font-bold text-amber-950">
                Job scrape không còn khả dụng
              </h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                {missingJobMessage} Quay lại danh sách để chọn job khác hoặc tạo
                job mới.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => router.push("/materials/scrape")}
            >
              Quay lại danh sách
            </Button>
          </div>
        </section>
      ) : null}

      {isJobDetailLoading ? (
        <section className="panel p-4 sm:p-5" aria-live="polite">
          <div className="flex items-start gap-3">
            <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-sky-600" aria-hidden />
            <div>
              <p className="section-title">Đang mở job scrape</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Tải trạng thái và preview sản phẩm…
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Trang sẽ tự cập nhật khi lấy được dữ liệu từ server.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {pendingScrapeJob && !activeJob ? (
        <section className="panel p-4 sm:p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Tiến độ job</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                {hostFromUrl(pendingScrapeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Đang tạo job nền trên server
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Đang khởi động
              </Badge>
              <Badge tone="neutral">
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatDuration(pendingScrapeDurationMs)}
              </Badge>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                <span>Trang</span>
                <span>{formatLimit(pendingScrapeJob.maxPages)}</span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ tạo job scrape theo trang"
                percent={null}
                active
                tone="sky"
              />
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                <span>Sản phẩm</span>
                <span>{formatLimit(pendingScrapeJob.maxProducts)}</span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ tạo job scrape theo sản phẩm"
                percent={null}
                active
                tone="emerald"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-600 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">Phạm vi: </span>
              {scrapeModeLabel[pendingScrapeJob.scrapeMode]}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">Cách đọc: </span>
              {scrapeMethodLabel[pendingScrapeJob.method]}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">Bổ sung: </span>
              {detailEnrichmentLabel[pendingScrapeJob.detailEnrichment]}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">URL: </span>
              <span className="break-all">{pendingScrapeJob.url}</span>
            </div>
          </div>
        </section>
      ) : null}

      {activeJob ? (
        <section className="panel p-4 sm:p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Tiến độ job</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                {hostFromUrl(activeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Job ID: {activeJob.id}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone[activeJob.status]}>
                {isActive ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : null}
                {statusLabel[activeJob.status]}
              </Badge>
              <Badge tone="info" count={activeJob.productCount}>
                Sản phẩm
              </Badge>
              <Badge tone="neutral" count={activeJob.pagesVisited.length}>
                Trang đã đọc
              </Badge>
              <Badge tone="neutral">
                {scrapeMethodLabel[activeJob.method]}
              </Badge>
              <Badge
                tone={
                  activeJob.detailEnrichment === "missing_fields"
                    ? "info"
                    : "warning"
                }
              >
                {detailEnrichmentLabel[activeJob.detailEnrichment]}
              </Badge>
              <Badge tone="neutral">
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatDuration(activeJob.durationMs)}
              </Badge>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>Trang đã đọc</span>
                <span>
                  {activeJob.pagesVisited.length.toLocaleString("vi-VN")} /{" "}
                  {formatLimit(activeJob.maxPages)}
                </span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ đọc trang của job scrape"
                percent={pagePercent}
                active={isActive}
                tone="sky"
              />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>Sản phẩm tìm thấy</span>
                <span>
                  {activeJob.productCount.toLocaleString("vi-VN")} /{" "}
                  {formatLimit(activeJob.maxProducts)}
                </span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ tìm sản phẩm của job scrape"
                percent={productPercent}
                active={isActive}
                tone="emerald"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-600 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">Đang đọc: </span>
              <span className="break-all">
                {activeJob.currentUrls.length > 0
                  ? activeJob.currentUrls.join(", ")
                  : "-"}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">
                Queue còn lại:{" "}
              </span>
              {activeJob.queueLength.toLocaleString("vi-VN")}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">Phạm vi: </span>
              {scrapeModeLabel[activeJob.scrapeMode]}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">
                Cập nhật cuối:{" "}
              </span>
              {activeJob.lastProgressAt
                ? new Date(activeJob.lastProgressAt).toLocaleString("vi-VN")
                : "-"}
            </div>
          </div>

          {activeJobMessage ? (
            <div
              className={
                activeJob.status === "failed"
                  ? "mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900"
                  : "mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900"
              }
            >
              {activeJobStopReason ? (
                <span className="font-semibold">{activeJobStopReason}: </span>
              ) : null}
              {activeJobMessage}
            </div>
          ) : null}

          {isPartialImportableJob ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Job dừng sớm — vẫn có thể nhập{" "}
              {activeJob.productCount.toLocaleString("vi-VN")} sản phẩm đã thu
              thập sau khi duyệt preview.
            </div>
          ) : null}

          {activeJob.detailEnrichment === "none" ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Job này chỉ đọc trang danh mục. Nếu NCC, xuất xứ hoặc thông số bị
              thiếu, chạy lại với chế độ “Bổ sung thiếu” để đọc trang chi tiết
              sản phẩm.
            </div>
          ) : null}

          {activeJob.failedPages.length > 0 ? (
            <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              <summary className="cursor-pointer font-semibold">
                {activeJob.failedPages.length.toLocaleString("vi-VN")} trang không
                đọc được. Job vẫn giữ các sản phẩm đã tìm thấy.
              </summary>
              <ul className="mt-2 space-y-2">
                {activeJob.failedPages.slice(0, 10).map((page, index) => (
                  <li
                    key={`${page.url}-${index}`}
                    className="rounded-md border border-amber-200 bg-white/80 px-2 py-1.5"
                  >
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-semibold text-amber-950 hover:underline"
                    >
                      {page.url}
                    </a>
                    <p className="mt-1 break-words text-amber-800">
                      {page.message}
                    </p>
                  </li>
                ))}
              </ul>
              {activeJob.failedPages.length > 10 ? (
                <p className="mt-2 text-amber-800">
                  Còn{" "}
                  {(activeJob.failedPages.length - 10).toLocaleString("vi-VN")}{" "}
                  trang lỗi khác.
                </p>
              ) : null}
            </details>
          ) : null}

          {activeJob.maxPages != null &&
          activeJob.pagesVisited.length >= activeJob.maxPages &&
          activeJob.productCount === 0 ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
              Đã đọc {activeJob.pagesVisited.length.toLocaleString("vi-VN")} /{" "}
              {activeJob.maxPages.toLocaleString("vi-VN")} trang nhưng không
              trích xuất được sản phẩm nào.
              {activeJob.failedPages.length > 0
                ? " Kiểm tra danh sách trang lỗi bên trên."
                : " Thử tăng giới hạn trang, bật “Bổ sung thiếu”, hoặc kiểm tra URL shop."}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeJob ? (
        <section id="material-scrape-products" className="panel p-4 sm:p-5">
          <ConfirmDialog
            open={deleteProductTarget !== null}
            title={`Xóa "${deleteProductTarget?.name ?? ""}" khỏi job scrape?`}
            description="Sản phẩm sẽ bị gỡ khỏi danh sách preview và không được nhập vào catalog khi bạn chạy import."
            confirmLabel="Xóa sản phẩm"
            variant="danger"
            isLoading={
              deleteShopScrapeJobProduct.isPending ||
              deleteShopScrapeJobProducts.isPending
            }
            onConfirm={() => {
              if (!activeJob || !deleteProductTarget) {
                return;
              }
              deleteShopScrapeJobProduct.mutate({
                jobId: activeJob.id,
                sourceUrl: deleteProductTarget.sourceUrl,
              });
            }}
            onCancel={() => setDeleteProductTarget(null)}
          />
          <ConfirmDialog
            open={bulkDeleteSelectedOpen}
            title={`Xóa ${selectedCount.toLocaleString("vi-VN")} sản phẩm đã chọn?`}
            description="Các sản phẩm đã chọn sẽ bị gỡ khỏi preview và không được nhập vào catalog."
            confirmLabel="Xóa đã chọn"
            variant="danger"
            isLoading={deleteShopScrapeJobProducts.isPending}
            onConfirm={() => {
              if (!activeJob || selectedCount === 0) {
                return;
              }
              deleteShopScrapeJobProducts.mutate({
                jobId: activeJob.id,
                sourceUrls: Array.from(selectedSourceUrls),
              });
            }}
            onCancel={() => setBulkDeleteSelectedOpen(false)}
          />
          <ScrapeProductDetailDialog
            open={detailDraft !== null}
            job={activeJob}
            product={detailDraft}
            productIndex={isCreatingProduct ? null : detailProductIndex}
            originalSourceUrl={detailOriginalSourceUrl}
            canEdit={canEditScrapeProducts}
            isSaving={
              updateShopScrapeJobProduct.isPending ||
              addShopScrapeJobProduct.isPending
            }
            isDeleting={deleteShopScrapeJobProduct.isPending}
            onChange={setDetailDraft}
            onClose={closeProductDetail}
            onSave={saveProductDetail}
            onDelete={() => {
              if (detailDraft) {
                setDeleteProductTarget(detailDraft);
              }
            }}
          />

          <MatchCompareDrawer
            open={compareProducts.length > 0}
            products={compareProducts}
            index={compareIndex}
            onNavigate={setCompareIndex}
            onClose={() => {
              setCompareProducts([]);
              setCompareIndex(0);
            }}
          />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Duyệt sản phẩm scrape</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Job {shortJobId(activeJob.id)} · {hostFromUrl(activeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {scrapeProducts.length.toLocaleString("vi-VN")} sản phẩm ·{" "}
                {scrapeModeLabel[activeJob.scrapeMode]} ·{" "}
                {scrapeMethodLabel[activeJob.method]} ·{" "}
                {detailEnrichmentLabel[activeJob.detailEnrichment]}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">ID {activeJob.id}</Badge>
                <Badge tone={statusTone[activeJob.status]}>
                  {statusLabel[activeJob.status]}
                </Badge>
                <Badge tone="info" count={activeJob.productCount}>
                  Preview
                </Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Bấm một dòng sản phẩm để xem chi tiết, chỉnh sửa hoặc xóa trước
                khi nhập catalog. Mã SP theo job:{" "}
                <span className="font-semibold text-slate-700">
                  {shortJobId(activeJob.id)}-###
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={scrapeProducts.length === 0}
                leftIcon={<Search className="h-3.5 w-3.5" />}
                onClick={() => {
                  const selected = scrapeProducts.filter((p) =>
                    selectedSourceUrls.has(productKey(p)),
                  );
                  const list = selected.length > 0 ? selected : scrapeProducts;
                  setCompareProducts(list);
                  setCompareIndex(0);
                }}
              >
                {selectedCount > 0
                  ? `Đối chiếu đã chọn (${selectedCount.toLocaleString("vi-VN")})`
                  : "Đối chiếu vật tư"}
              </Button>
              {canEditScrapeProducts ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={openCreateProductDetail}
                >
                  Thêm sản phẩm
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={scrapeProducts.length === 0}
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => void downloadScrapeCsv()}
              >
                Tải CSV preview
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={filteredScrapeProducts.length === 0 || isImportActive}
                leftIcon={
                  allSelected ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )
                }
                onClick={selectAllProducts}
              >
                {allSelected ? "Bỏ chọn sau lọc" : "Chọn sau lọc"}
              </Button>
              {canEditScrapeProducts ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!canDeleteSelected || deleteShopScrapeJobProducts.isPending}
                  isLoading={deleteShopScrapeJobProducts.isPending}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setBulkDeleteSelectedOpen(true)}
                >
                  Xóa đã chọn ({selectedCount.toLocaleString("vi-VN")})
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canImportSelected}
                isLoading={
                  startShopImportJob.isPending &&
                  startShopImportJob.variables?.productSourceUrls !== undefined
                }
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={importSelected}
              >
                Nhập đã chọn ({selectedCount.toLocaleString("vi-VN")})
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!canImportAll}
                isLoading={
                  startShopImportJob.isPending &&
                  startShopImportJob.variables?.productSourceUrls === undefined
                }
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={importAll}
              >
                Nhập tất cả
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <div
              className={
                isImportActive
                  ? "rounded-lg border border-sky-200 bg-sky-50 p-3"
                  : "rounded-lg border border-slate-200 bg-white p-3"
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                    Quá trình nhập catalog
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {activeImportJob
                      ? `${activeImportJob.processed.toLocaleString(
                          "vi-VN",
                        )} / ${activeImportJob.total.toLocaleString("vi-VN")}`
                      : `${selectedCount.toLocaleString(
                          "vi-VN",
                        )} đã chọn / ${scrapeProducts.length.toLocaleString(
                          "vi-VN",
                        )} có thể nhập`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {activeImportJob ? (
                    <Badge tone={importStatusTone[activeImportJob.status]}>
                      {isImportActive ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : null}
                      {importStatusLabel[activeImportJob.status]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Chưa chạy</Badge>
                  )}
                  {isImportActive && activeImportJob ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      isLoading={cancelShopImportJob.isPending}
                      leftIcon={<StopCircle className="h-3.5 w-3.5" />}
                      onClick={() => setCancelImportOpen(true)}
                    >
                      Hủy nhập
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>Tiến độ ghi DB</span>
                <span>{activeImportJob ? `${importPercent ?? 0}%` : "0%"}</span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ nhập catalog"
                percent={importPercent}
                active={isImportActive}
                tone="sky"
              />

              {activeImportJob ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="success" count={activeImportJob.created}>
                      Tạo mới
                    </Badge>
                    <Badge tone="info" count={activeImportJob.updated}>
                      Cập nhật
                    </Badge>
                    <Badge tone="neutral" count={activeImportJob.skipped}>
                      Bỏ qua
                    </Badge>
                    <Badge
                      tone={activeImportJob.failed > 0 ? "critical" : "neutral"}
                      count={activeImportJob.failed}
                    >
                      Lỗi
                    </Badge>
                    <Badge tone="neutral">
                      <Clock3 className="h-3 w-3" aria-hidden />
                      {formatDuration(activeImportJob.durationMs)}
                    </Badge>
                  </div>
                  <p className="mt-2 truncate text-xs text-slate-600">
                    Mục hiện tại: {activeImportJob.currentProductName ?? "-"}
                  </p>
                  {activeImportJob.error ? (
                    <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900">
                      {activeImportJob.error}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Sẵn sàng ghi catalog sau khi chọn sản phẩm.
                </p>
              )}
            </div>
          </div>

          {scrapeProducts.length > 0 || activeJob.productCount > 0 ? (
            <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap gap-2">
                {SCRAPE_QUALITY_FILTER_OPTIONS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={
                      qualityFilter === filter
                        ? "rounded-full border border-sky-400 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900"
                        : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-sky-200"
                    }
                    onClick={() =>
                      setQualityFilter((current) =>
                        current === filter ? "all" : filter,
                      )
                    }
                    aria-pressed={qualityFilter === filter}
                  >
                    {SCRAPE_QUALITY_FLAG_LABELS[filter]}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-sky-600"
                  checked={hideMissingNameProducts}
                  onChange={(event) =>
                    setHideMissingNameProducts(event.target.checked)
                  }
                />
                Ẩn sản phẩm thiếu tên
              </label>
            </div>

            {isActive && scrapeProducts.length === 0 && activeJob.productCount > 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                Đang thu thập {activeJob.productCount.toLocaleString("vi-VN")}{" "}
                sản phẩm — bảng preview sẽ hiện đầy đủ khi job dừng.
              </p>
            ) : null}

          {scrapeProducts.length > 0 ? (
            <>
            <div className="mt-4 grid gap-3 lg:hidden">
              {pagedScrapeProducts.map((item, index) => {
                const key = productKey(item);
                const selected = selectedSourceUrls.has(key);
                const missingLabels = productMissingLabels(item);
                const rowQualityFlags = qualityFlags(item);
                const infoSummary = productInfoSummary(item);
                const globalIndex = productPageIndex * productPageSize + index;

                return (
                  <ScrapeProductReviewCard
                    key={`${key}-${index}-card`}
                    name={item.name}
                    displayId={productDisplayId(activeJob.id, globalIndex)}
                    selected={selected}
                    disabled={isImportActive}
                    infoSummary={infoSummary}
                    priceText={formatMoney(item.price, item.currency)}
                    unit={item.unit ?? "-"}
                    manufacturer={item.manufacturer ?? "-"}
                    originCountry={item.originCountry ?? "-"}
                    missingLabels={missingLabels}
                    suspiciousName={rowQualityFlags.includes("suspiciousName")}
                    missingPrice={rowQualityFlags.includes("missingPrice")}
                    catalogPdfCount={item.catalogPdfUrls.length}
                    sourceUrl={item.sourceUrl}
                    canEdit={canEditScrapeProducts}
                    isDeleting={deleteShopScrapeJobProduct.isPending}
                    onToggle={() => toggleProduct(item)}
                    onOpen={() => openProductDetail(item)}
                    onDelete={() => setDeleteProductTarget(item)}
                  />
                );
              })}
            </div>

            <div className="mt-4 hidden overflow-x-auto rounded-lg border border-slate-200 lg:block">
              <table className="w-full min-w-[60rem] table-fixed divide-y divide-slate-200 text-sm break-words">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2"> </th>
                    <th className="px-3 py-2">Mã SP</th>
                    <th className="px-3 py-2">Sản phẩm</th>
                    <th className="px-3 py-2">Đơn giá</th>
                    <th className="px-3 py-2">Đơn vị</th>
                    <th className="px-3 py-2">Nhóm</th>
                    <th className="px-3 py-2">NCC</th>
                    <th className="px-3 py-2">Xuất xứ</th>
                    <th className="px-3 py-2">Thông số</th>
                    <th className="px-3 py-2">Độ đầy đủ</th>
                    <th className="px-3 py-2">Nguồn</th>
                    <th className="px-3 py-2 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pagedScrapeProducts.map((item, index) => {
                    const key = productKey(item);
                    const selected = selectedSourceUrls.has(key);
                    const missingLabels = productMissingLabels(item);
                    const infoSummary = productInfoSummary(item);
                    const rowQualityFlags = qualityFlags(item);
                    const globalIndex = productPageIndex * productPageSize + index;

                    const isDetailOpen = detailProductKey === key;

                    return (
                      <tr
                        key={`${key}-${index}`}
                        tabIndex={0}
                        aria-selected={isDetailOpen}
                        className={`cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none focus-visible:ring-inset ${
                          isDetailOpen
                            ? "bg-sky-100/80"
                            : selected
                              ? "bg-sky-50/70 hover:bg-sky-50"
                              : "hover:bg-slate-50"
                        }`}
                        onClick={() => openProductDetail(item)}
                        onKeyDown={(event) => {
                          if (event.currentTarget !== event.target) {
                            return;
                          }
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openProductDetail(item);
                          }
                        }}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-sky-600"
                            checked={selected}
                            disabled={isImportActive}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleProduct(item)}
                            aria-label={`Chọn ${item.name}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs font-bold text-slate-700">
                            {productDisplayId(activeJob.id, globalIndex)}
                          </span>
                        </td>
                        <td className="max-w-sm px-3 py-2 font-semibold text-slate-950">
                          <span className="line-clamp-2">{item.name}</span>
                          <span className="mt-1 block text-xs font-medium text-slate-500">
                            {infoSummary || "Không có SKU / model / trạng thái"}
                          </span>
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700">
                            <Eye className="h-3 w-3" aria-hidden />
                            Xem chi tiết
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900 tabular-nums">
                          {formatMoney(item.price, item.currency)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {item.unit ?? "unknown"}
                        </td>
                        <td className="max-w-44 px-3 py-2 text-slate-600">
                          <span className="line-clamp-2">
                            {item.category ?? item.shopCategory ?? "-"}
                          </span>
                        </td>
                        <td className="max-w-44 px-3 py-2 text-slate-600">
                          <span className="line-clamp-2">
                            {item.manufacturer ?? "-"}
                          </span>
                        </td>
                        <td className="max-w-36 px-3 py-2 text-slate-600">
                          <span className="line-clamp-2">
                            {item.originCountry ?? "-"}
                          </span>
                        </td>
                        <td className="max-w-md px-3 py-2 text-slate-600">
                          <span className="line-clamp-3">
                            {item.specText || "-"}
                          </span>
                        </td>
                        <td className="max-w-56 px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {missingLabels.length === 0 &&
                            rowQualityFlags.length === 0 ? (
                              <Badge tone="success">Đủ thông tin</Badge>
                            ) : (
                              <>
                                {missingLabels.map((label) => (
                                  <Badge key={label} tone="warning">
                                    {label}
                                  </Badge>
                                ))}
                                {rowQualityFlags.includes("suspiciousName") ? (
                                  <Badge tone="critical">Tên nghi vấn</Badge>
                                ) : null}
                                {rowQualityFlags.includes("missingPrice") ? (
                                  <Badge tone="warning">Thiếu giá</Badge>
                                ) : null}
                              </>
                            )}
                            {item.catalogPdfUrls.length > 0 ? (
                              <Badge tone="info">
                                {item.catalogPdfUrls.length} catalog PDF
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Mở trang nguồn của ${item.name}`}
                            title={item.sourceUrl}
                          >
                            <ExternalLink
                              className="h-3.5 w-3.5 shrink-0"
                              aria-hidden
                            />
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
                              onClick={(event) => {
                                event.stopPropagation();
                                openProductDetail(item);
                              }}
                              aria-label={`Xem chi tiết ${item.name}`}
                              title="Xem chi tiết"
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            {canEditScrapeProducts ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-200 bg-white text-amber-800 transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openProductDetail(item);
                                  }}
                                  aria-label={`Sửa ${item.name}`}
                                  title="Sửa sản phẩm"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition-colors hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none disabled:opacity-60"
                                  disabled={deleteShopScrapeJobProduct.isPending}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteProductTarget(item);
                                  }}
                                  aria-label={`Xóa ${item.name} khỏi job`}
                                  title="Xóa khỏi preview — không nhập DB"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          ) : null}

            {filteredScrapeProducts.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                <p>
                  Hiển thị{" "}
                  {(productPageIndex * productPageSize + 1).toLocaleString(
                    "vi-VN",
                  )}
                  –
                  {Math.min(
                    (productPageIndex + 1) * productPageSize,
                    filteredScrapeProducts.length,
                  ).toLocaleString("vi-VN")}{" "}
                  / {filteredScrapeProducts.length.toLocaleString("vi-VN")} sau
                  lọc
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <span>Dòng/trang</span>
                    <select
                      className="rounded-md border border-slate-300 bg-white px-2 py-1"
                      value={productPageSize}
                      aria-label="Số sản phẩm mỗi trang"
                      onChange={(event) => {
                        setProductPageSize(Number(event.target.value));
                        setProductPageIndex(0);
                      }}
                    >
                      {[25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={productPageIndex === 0}
                    onClick={() =>
                      setProductPageIndex((current) => Math.max(0, current - 1))
                    }
                  >
                    Trang trước
                  </Button>
                  <span>
                    Trang {productPageIndex + 1} / {productPageCount}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={productPageIndex + 1 >= productPageCount}
                    onClick={() =>
                      setProductPageIndex((current) =>
                        Math.min(productPageCount - 1, current + 1),
                      )
                    }
                  >
                    Trang sau
                  </Button>
                </div>
              </div>
            ) : scrapeProducts.length > 0 ? (
              <EmptyState
                className="mt-4"
                title="Không có sản phẩm khớp bộ lọc."
                description="Thử bỏ bộ lọc chất lượng hoặc tắt ẩn sản phẩm thiếu tên."
              />
            ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {importResult ? (
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Kết quả nhập</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Đã ghi vào catalog vật tư
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success" count={importResult.created}>
                Tạo mới
              </Badge>
              <Badge tone="info" count={importResult.updated}>
                Cập nhật
              </Badge>
              <Badge tone="neutral" count={importResult.skipped}>
                Bỏ qua
              </Badge>
              <Badge
                tone={importResult.failed > 0 ? "critical" : "neutral"}
                count={importResult.failed}
              >
                Lỗi
              </Badge>
              <Badge tone="neutral">
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatDuration(importResult.durationMs)}
              </Badge>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[34rem] table-fixed divide-y divide-slate-200 text-sm break-words">
              <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Sản phẩm</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Nguồn</th>
                  <th className="px-3 py-2 text-right">Mở</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {importResult.items.map((item, index) => (
                  <tr key={`${item.sourceUrl}-${item.name}-${index}`}>
                    <td className="max-w-sm px-3 py-2 font-semibold text-slate-950">
                      <span className="line-clamp-2">{item.name}</span>
                      {item.message ? (
                        <span className="mt-1 block text-xs font-medium text-slate-500">
                          {item.message}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={actionTone[item.action]}>
                        {actionLabel[item.action]}
                      </Badge>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-xs text-slate-600">
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 hover:text-sky-700 hover:underline"
                      >
                        {item.sourceUrl}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.materialId ? (
                        <Link
                          href={`/materials/${item.materialId}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-sky-700"
                          aria-label={`Mở vật tư ${item.name}`}
                        >
                          <ArrowUpRight className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
        </>
      )}
    </div>
  );
}
