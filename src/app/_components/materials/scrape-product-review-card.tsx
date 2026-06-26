"use client";

import { ExternalLink, Eye, Trash2 } from "lucide-react";

import { Badge, Button } from "~/app/_components/ui";

export function ScrapeProductReviewCard({
  name,
  displayId,
  selected,
  disabled,
  infoSummary,
  priceText,
  unit,
  manufacturer,
  originCountry,
  missingLabels,
  suspiciousName,
  missingPrice,
  catalogPdfCount,
  sourceUrl,
  canEdit,
  isDeleting,
  onToggle,
  onOpen,
  onDelete,
}: {
  name: string;
  displayId: string;
  selected: boolean;
  disabled: boolean;
  infoSummary: string;
  priceText: string;
  unit: string;
  manufacturer: string;
  originCountry: string;
  missingLabels: string[];
  suspiciousName: boolean;
  missingPrice: boolean;
  catalogPdfCount: number;
  sourceUrl: string;
  canEdit: boolean;
  isDeleting: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={
        selected
          ? "rounded border border-blue-200 bg-blue-50 p-3 shadow-sm"
          : "rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3 shadow-sm"
      }
    >
      <div className="flex items-start gap-1">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-400 accent-blue-600"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Chọn ${name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-slate-700">
              {displayId}
            </span>
            <Badge tone={selected ? "info" : "neutral"}>
              {selected ? "Đã chọn" : "Preview"}
            </Badge>
          </div>
          <button
            type="button"
            className="mt-2 block w-full text-left text-sm font-bold text-slate-950 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            onClick={onOpen}
          >
            {name}
          </button>
          <p className="mt-1 line-clamp-2 text-xs text-slate-700">
            {infoSummary || "Không có SKU / model / trạng thái"}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-700">Giá</dt>
          <dd className="font-bold text-slate-900 tabular-nums">{priceText}</dd>
        </div>
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-700">Đơn vị</dt>
          <dd className="font-bold text-slate-900">{unit}</dd>
        </div>
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-700">NCC</dt>
          <dd className="line-clamp-2 text-slate-800">{manufacturer}</dd>
        </div>
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-700">Xuất xứ</dt>
          <dd className="line-clamp-2 text-slate-800">{originCountry}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        {missingLabels.length === 0 && !suspiciousName && !missingPrice ? (
          <Badge tone="success">Đủ thông tin</Badge>
        ) : (
          <>
            {missingLabels.map((label) => (
              <Badge key={label} tone="warning">
                {label}
              </Badge>
            ))}
            {suspiciousName ? <Badge tone="critical">Tên nghi vấn</Badge> : null}
            {missingPrice ? <Badge tone="warning">Thiếu giá</Badge> : null}
          </>
        )}
        {catalogPdfCount > 0 ? (
          <Badge tone="info">{catalogPdfCount} catalog PDF</Badge>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<Eye className="h-3.5 w-3.5" />}
          onClick={onOpen}
        >
          Xem chi tiết
        </Button>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-8 items-center gap-1 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Nguồn
        </a>
        {canEdit ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isDeleting}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={onDelete}
          >
            Xóa
          </Button>
        ) : null}
      </div>
    </article>
  );
}
