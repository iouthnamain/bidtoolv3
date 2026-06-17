"use client";

import { useState } from "react";

import { CheckCheck, Download, ImageOff, ThumbsDown, ThumbsUp } from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import {
  type ExcelResearchRowStatus,
} from "~/app/_components/research-enrich/excel-research-types";
import {
  FIELD_LABELS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import { type RouterOutputs } from "~/trpc/react";

type ExcelResearchRowSummary =
  RouterOutputs["excelResearch"]["listRowResults"]["items"][number];
type ExcelResearchRowEvidence =
  RouterOutputs["excelResearch"]["getRowResult"]["evidence"][number];

export const ROW_STATUS_META: Record<
  ExcelResearchRowStatus,
  { label: string; tone: "success" | "warning" | "neutral" | "critical" }
> = {
  pending: { label: "Chờ xử lý", tone: "neutral" },
  processing: { label: "Đang xử lý", tone: "neutral" },
  matched: { label: "Đã khớp", tone: "success" },
  needs_review: { label: "Cần duyệt", tone: "warning" },
  approved: { label: "Đã duyệt", tone: "success" },
  skipped: { label: "Đã bỏ qua", tone: "critical" },
  error: { label: "Lỗi", tone: "critical" },
};

function fieldLabel(field: string) {
  return FIELD_LABELS[field as FillableField] ?? field;
}

const BULK_MIN_CONFIDENCE = 0.85;

const BULK_APPROVABLE_STATUSES: ExcelResearchRowStatus[] = [
  "needs_review",
  "matched",
  "pending",
];

function confidencePercent(score: number | null) {
  if (score == null) return null;
  return Math.round(score * 100);
}

export function ExcelResearchReviewPanel({
  rows,
  summary,
  statusFilter,
  setStatusFilter,
  selectedRowNumber,
  setSelectedRowNumber,
  selectedRow,
  evidence,
  isDetailLoading,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  onBulkApprove,
  isBulkApproving = false,
  onPrimaryAction,
  onSecondaryAction,
  primaryActionLabel = "Tiếp tục xuất file",
  secondaryActionLabel = "Bỏ qua",
  showPrimaryDownloadIcon = true,
  emptyContinueLabel = "Tiếp tục xuất file",
}: {
  rows: ExcelResearchRowSummary[];
  summary: {
    total: number;
    needsReview: number;
    approved: number;
    matched: number;
    skipped: number;
    errors: number;
  };
  statusFilter: ExcelResearchRowStatus | "all";
  setStatusFilter: (value: ExcelResearchRowStatus | "all") => void;
  selectedRowNumber: number | null;
  setSelectedRowNumber: (value: number | null) => void;
  selectedRow: ExcelResearchRowSummary | null;
  evidence: ExcelResearchRowEvidence[];
  isDetailLoading: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: (rowNumber: number) => void;
  onReject: (rowNumber: number) => void;
  /**
   * Bulk approve. `rowIds` approves an explicit set of rows; when omitted the
   * caller falls back to its threshold logic (`minConfidence`).
   */
  onBulkApprove?: (args: { rowIds?: string[]; minConfidence?: number }) => void;
  isBulkApproving?: boolean;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  showPrimaryDownloadIcon?: boolean;
  emptyContinueLabel?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  if (rows.length === 0) {
    return (
      <section className="panel p-5">
        <EmptyState
          title="Không có dòng kết quả"
          description="Job hoàn tất nhưng chưa có dòng nào để xét duyệt."
        />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={onPrimaryAction}>
            {emptyContinueLabel}
          </Button>
        </div>
      </section>
    );
  }

  const bulkApprovableRows = rows.filter((row) =>
    BULK_APPROVABLE_STATUSES.includes(row.status),
  );
  const confidentNeedsReview = bulkApprovableRows.filter(
    (row) =>
      row.status === "needs_review" &&
      row.confidenceScore != null &&
      row.confidenceScore >= BULK_MIN_CONFIDENCE,
  );
  const selectedApprovable = bulkApprovableRows.filter((row) =>
    selectedIds.has(row.id),
  );

  const toggleRowSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = bulkApprovableRows.every((row) => prev.has(row.id));
      if (allSelected) return new Set();
      return new Set(bulkApprovableRows.map((row) => row.id));
    });
  };

  const approveSelected = () => {
    if (!onBulkApprove || selectedApprovable.length === 0) return;
    onBulkApprove({
      rowIds: selectedApprovable.map((row) => String(row.id)),
    });
    setSelectedIds(new Set());
  };

  const approveConfident = () => {
    if (!onBulkApprove || confidentNeedsReview.length === 0) return;
    onBulkApprove({ minConfidence: BULK_MIN_CONFIDENCE });
    setSelectedIds(new Set());
  };

  const allApprovableSelected =
    bulkApprovableRows.length > 0 &&
    bulkApprovableRows.every((row) => selectedIds.has(row.id));

  const filters: Array<{
    id: ExcelResearchRowStatus | "all";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "Tất cả", count: summary.total },
    { id: "needs_review", label: "Cần duyệt", count: summary.needsReview },
    { id: "matched", label: "Đã khớp", count: summary.matched },
    { id: "approved", label: "Đã duyệt", count: summary.approved },
    { id: "skipped", label: "Bỏ qua", count: summary.skipped },
    { id: "error", label: "Lỗi", count: summary.errors },
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 text-balance">
            Xét duyệt kết quả nghiên cứu web
          </h3>
          <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="tabular-nums">{summary.total.toLocaleString("vi-VN")} dòng</span>
            <span className="tabular-nums">
              {summary.needsReview.toLocaleString("vi-VN")} cần duyệt
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={
              showPrimaryDownloadIcon ? (
                <Download className="h-3.5 w-3.5" />
              ) : undefined
            }
            onClick={onPrimaryAction}
          >
            {primaryActionLabel}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 px-4 py-2">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setStatusFilter(filter.id)}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
              statusFilter === filter.id
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {filter.label} ({filter.count.toLocaleString("vi-VN")})
          </button>
        ))}
      </div>

      {onBulkApprove ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={allApprovableSelected}
              disabled={bulkApprovableRows.length === 0}
              onChange={toggleSelectAll}
            />
            Chọn tất cả ({bulkApprovableRows.length.toLocaleString("vi-VN")})
          </label>
          {selectedApprovable.length > 0 ? (
            <span className="text-xs text-slate-500">
              Đã chọn {selectedApprovable.length.toLocaleString("vi-VN")} dòng
            </span>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<CheckCheck className="h-3.5 w-3.5" />}
              isLoading={isBulkApproving}
              disabled={selectedApprovable.length === 0}
              onClick={approveSelected}
            >
              Duyệt mục đã chọn
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<CheckCheck className="h-3.5 w-3.5" />}
              isLoading={isBulkApproving}
              disabled={confidentNeedsReview.length === 0}
              onClick={approveConfident}
            >
              Duyệt tất cả đủ tin cậy (≥ {Math.round(BULK_MIN_CONFIDENCE * 100)}%
              {confidentNeedsReview.length > 0
                ? ` · ${confidentNeedsReview.length.toLocaleString("vi-VN")}`
                : ""}
              )
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto border-b border-slate-200 lg:max-h-[40rem] lg:border-b-0 lg:border-r">
          {rows.map((row) => {
            const meta = ROW_STATUS_META[row.status];
            const isSelected = row.rowNumber === selectedRowNumber;
            const isApprovable = BULK_APPROVABLE_STATUSES.includes(row.status);
            const pct = confidencePercent(row.confidenceScore);
            return (
              <div
                key={row.id}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-violet-50" : "hover:bg-slate-50"
                }`}
              >
                {onBulkApprove ? (
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedIds.has(row.id)}
                    disabled={!isApprovable}
                    onChange={() => toggleRowSelected(row.id)}
                    aria-label={`Chọn dòng ${row.rowNumber}`}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedRowNumber(row.rowNumber)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {row.productName || `Dòng ${row.rowNumber}`}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span>Dòng {row.rowNumber}</span>
                      {pct != null ? (
                        <span
                          className={`font-semibold tabular-nums ${
                            pct >= 85
                              ? "text-emerald-700"
                              : pct >= 50
                                ? "text-amber-700"
                                : "text-slate-500"
                          }`}
                        >
                          {pct}%
                        </span>
                      ) : null}
                    </p>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        <div className="min-w-0 p-4">
          {selectedRow ? (
            <ExcelResearchRowDetailPanel
              row={selectedRow}
              evidence={evidence}
              isDetailLoading={isDetailLoading}
              isApproving={isApproving}
              isRejecting={isRejecting}
              onApprove={() => onApprove(selectedRow.rowNumber)}
              onReject={() => onReject(selectedRow.rowNumber)}
            />
          ) : (
            <EmptyState
              title="Chọn một dòng"
              description="Chọn dòng ở danh sách bên trái để xem bằng chứng."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ExcelResearchRowDetailPanel({
  row,
  evidence,
  isDetailLoading,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
}: {
  row: ExcelResearchRowSummary;
  evidence: ExcelResearchRowEvidence[];
  isDetailLoading: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const meta = ROW_STATUS_META[row.status];
  const canDecide =
    row.status === "needs_review" ||
    row.status === "matched" ||
    row.status === "pending";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
              Dòng Excel {row.rowNumber}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {row.productName || "(không có tên)"}
            </p>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        {row.reviewReason ? (
          <p className="mt-2 text-xs text-amber-800">{row.reviewReason}</p>
        ) : null}
      </div>

      {isDetailLoading ? (
        <p className="text-xs text-slate-500">Đang tải bằng chứng…</p>
      ) : evidence.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">Bằng chứng</p>
          {evidence.map((item) => (
            <div
              key={item.id}
              className="flex gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs"
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-300">
                    <ImageOff className="h-5 w-5" aria-hidden />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">
                  {item.title ?? item.evidenceType}
                </p>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block truncate text-sky-600 hover:underline"
                  >
                    {item.url}
                  </a>
                ) : null}
                {item.snippet ? (
                  <p className="mt-1 text-slate-600">{item.snippet}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {row.fillPlan.length > 0 ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-700">Kế hoạch điền</p>
          <div className="mt-2 grid gap-1">
            {row.fillPlan.map((cell) => (
              <div
                key={cell.field}
                className="flex gap-2 text-xs text-slate-600"
              >
                <span className="w-24 shrink-0 font-semibold">
                  {fieldLabel(cell.field)}
                </span>
                <span className="truncate">{cell.before || "(trống)"}</span>
                {cell.action === "filled" ? (
                  <>
                    <span>→</span>
                    <span className="truncate font-medium text-emerald-700">
                      {cell.after}
                    </span>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<ThumbsUp className="h-3.5 w-3.5" />}
            isLoading={isApproving}
            disabled={isRejecting}
            onClick={onApprove}
          >
            Duyệt
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ThumbsDown className="h-3.5 w-3.5" />}
            isLoading={isRejecting}
            disabled={isApproving}
            onClick={onReject}
          >
            Từ chối
          </Button>
        </div>
      ) : null}
    </div>
  );
}
