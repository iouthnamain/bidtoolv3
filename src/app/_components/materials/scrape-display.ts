import type { Badge } from "~/app/_components/ui";
import {
  formatDuration,
  shortJobId,
  type DetailEnrichmentMode,
  type ImportJob,
  type ImportShopItem,
  type ScrapeJob,
  type ScrapeJobListItem,
  type ScrapeMethod,
  type ScrapeMode,
  type ScrapedProduct,
} from "~/app/_components/materials/scrape-job-utils";
import type { ScrapeQualityFlag } from "~/lib/materials/scrape-product-quality";

export const SCRAPE_QUALITY_FILTER_OPTIONS: ScrapeQualityFlag[] = [
  "missingPrice",
  "missingNcc",
  "missingOrigin",
  "missingSpec",
  "suspiciousName",
  "hasPdf",
];

export const scrapeModeLabel: Record<ScrapeMode, string> = {
  limited: "Giới hạn",
  all: "Scrape hết",
};

export const scrapeMethodLabel: Record<ScrapeMethod, string> = {
  auto: "Tự động",
  json_ld: "JSON-LD",
  dom_cards: "DOM cards",
};

export const scrapeMethodHelp: Record<ScrapeMethod, string> = {
  auto: "Dùng dữ liệu có cấu trúc trước, bổ sung bằng thẻ sản phẩm.",
  json_ld: "Chỉ đọc schema Product/ItemList trong JSON-LD.",
  dom_cards: "Chỉ đọc các card sản phẩm hiển thị trên trang.",
};

export const detailEnrichmentLabel: Record<DetailEnrichmentMode, string> = {
  none: "Không đọc chi tiết",
  missing_fields: "Bổ sung thiếu",
};

export const detailEnrichmentHelp: Record<DetailEnrichmentMode, string> = {
  none: "Nhanh hơn, chỉ lấy dữ liệu trên trang danh mục.",
  missing_fields:
    "Chậm hơn nhưng mở trang sản phẩm để tìm NCC, xuất xứ, thông số và nhóm còn thiếu.",
};

export const actionTone: Record<
  ImportShopItem["action"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  created: "success",
  updated: "info",
  skipped: "neutral",
  failed: "critical",
};

export const actionLabel: Record<ImportShopItem["action"], string> = {
  created: "Tạo mới",
  updated: "Cập nhật",
  skipped: "Bỏ qua",
  failed: "Lỗi",
};

export const statusLabel: Record<ScrapeJob["status"], string> = {
  queued: "Đang xếp hàng",
  running: "Đang scrape",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

export const statusTone: Record<
  ScrapeJob["status"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

export const stopReasonLabel: Record<
  NonNullable<ScrapeJob["stopReason"]>,
  string
> = {
  queue_empty: "Đã đọc hết queue",
  page_limit: "Đạt giới hạn trang",
  product_limit: "Đạt giới hạn sản phẩm",
  timeout: "Quá thời gian",
  cancelled: "Đã hủy",
  error: "Lỗi",
  expired: "Hết hạn",
};

export const importStatusLabel: Record<ImportJob["status"], string> = {
  queued: "Đang xếp hàng",
  running: "Đang nhập",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

export const importStatusTone: Record<
  ImportJob["status"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

export function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

export function elapsedMsForJob(job: ScrapeJobListItem, nowMs: number) {
  if (job.durationMs != null) {
    return job.durationMs;
  }

  const startedAtMs = new Date(job.startedAt).getTime();
  const finishedAtMs = job.finishedAt
    ? new Date(job.finishedAt).getTime()
    : nowMs;
  return Math.max(0, finishedAtMs - startedAtMs);
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function formatLimit(value: number | null | undefined) {
  return value == null ? "Không giới hạn" : value.toLocaleString("vi-VN");
}

export function productDisplayId(jobId: string, index: number) {
  return `${shortJobId(jobId)}-${String(index + 1).padStart(3, "0")}`;
}

export function emptyScrapedProduct(jobUrl: string): ScrapedProduct {
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

export function productMissingLabels(product: ScrapedProduct) {
  return [
    product.manufacturer ? null : "Thiếu NCC",
    product.originCountry ? null : "Thiếu xuất xứ",
    product.category ? null : "Thiếu nhóm",
    product.specText.trim() ? null : "Thiếu thông số",
    product.unit ? null : "ĐVT unknown",
  ].filter((label): label is string => Boolean(label));
}

export function productInfoSummary(product: ScrapedProduct) {
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

export { formatDuration };
