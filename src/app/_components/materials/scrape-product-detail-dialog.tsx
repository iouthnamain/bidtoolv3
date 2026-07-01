"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, Save, Trash2, X } from "lucide-react";

import { Badge, Button } from "~/app/_components/ui";
import { wideModalDialogClass } from "~/app/_components/ui/dialog-classes";
import {
  detailEnrichmentLabel,
  productDisplayId,
  productMissingLabels,
  scrapeMethodLabel,
  scrapeModeLabel,
  statusLabel,
  statusTone,
} from "~/app/_components/materials/scrape-display";
import {
  hostFromUrl,
  shortJobId,
  type ScrapeJob,
  type ScrapedProduct,
} from "~/app/_components/materials/scrape-job-utils";

const scrapeFieldClass =
  "min-h-10 w-full rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none";

export function ScrapeProductDetailDialog({
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
      className={wideModalDialogClass}
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
      <div className="border-b border-slate-400 px-2 py-4">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
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
              className="mt-2 text-xs text-slate-700"
            >
              {scrapeModeLabel[job.scrapeMode]} · {scrapeMethodLabel[job.method]}{" "}
              · {detailEnrichmentLabel[job.detailEnrichment]}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-500 bg-white text-slate-700 shadow-[var(--shadow-flat)] hover:border-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            onClick={onClose}
            aria-label="Đóng chi tiết sản phẩm"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        {!canEdit ? (
          <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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

        <div className="grid gap-1 md:grid-cols-2">
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-400 px-2 py-4">
        <div className="flex flex-wrap gap-2">
          {product.sourceUrl ? (
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
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
