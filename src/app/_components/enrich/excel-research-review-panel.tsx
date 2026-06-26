"use client";

import { useEffect, useState } from "react";

import { CheckCheck, Download, ImageOff, ThumbsDown, ThumbsUp } from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import {
  type ExcelResearchRowStatus,
} from "~/app/_components/research-enrich/excel-research-types";
import { FieldCompareEditor } from "~/app/_components/enrich/field-compare-editor";
import { type EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import {
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import { api, type RouterOutputs } from "~/trpc/react";

type ExcelResearchRowSummary =
  RouterOutputs["excelResearch"]["listRowResults"]["items"][number];
type ExcelResearchRowEvidence =
  RouterOutputs["excelResearch"]["getRowResult"]["evidence"][number];
type ExcelResearchCompare =
  RouterOutputs["excelResearch"]["getRowResult"]["compare"];

/** The decision payload an approved row carries to the server. */
export type ResearchApproveDecision = {
  materialId?: number;
  acceptedFields: FillableField[];
  overwriteFields: FillableField[];
  editedValues: Partial<Record<FillableField, string>>;
};

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
  compare,
  isDetailLoading,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  onBulkApprove,
  isBulkApproving = false,
  listTotal,
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
  compare: ExcelResearchCompare | null;
  isDetailLoading: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: (rowNumber: number, decision: ResearchApproveDecision) => void;
  onReject: (rowNumber: number) => void;
  /**
   * Bulk approve. `rowIds` approves an explicit set of rows; when omitted the
   * caller falls back to its threshold logic (`minConfidence`).
   */
  onBulkApprove?: (args: { rowIds?: string[]; minConfidence?: number }) => void;
  isBulkApproving?: boolean;
  /**
   * Total rows matching the active filter on the server. When it exceeds the
   * number of rows actually returned (`rows.length`, capped at the page
   * limit) the list is truncated and we surface a notice.
   */
  listTotal?: number;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  showPrimaryDownloadIcon?: boolean;
  emptyContinueLabel?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  // Selecting a different filter changes which rows are visible; carrying the
  // old selection over would let a user bulk-approve rows they can't see and
  // desync the select-all checkbox. Clear it whenever the filter changes.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter]);

  if (rows.length === 0) {
    return (
      <section className="panel p-2">
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
  // The confident-approve button approves server-side across the WHOLE job
  // (bulkApproveRows with minConfidence, no rowIds), so its enabled state must
  // reflect the job-wide needs_review + matched totals — not just visible rows
  // (capped at the page limit) or just needs_review. Threshold filtering then
  // happens on the server.
  const jobConfidentCandidates = summary.needsReview + summary.matched;
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
    if (!onBulkApprove || jobConfidentCandidates === 0) return;
    onBulkApprove({ minConfidence: BULK_MIN_CONFIDENCE });
    setSelectedIds(new Set());
  };

  const allApprovableSelected =
    bulkApprovableRows.length > 0 &&
    bulkApprovableRows.every((row) => selectedIds.has(row.id));

  const isTruncated = listTotal != null && listTotal > rows.length;

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
      <div className="flex flex-wrap items-start justify-between gap-1 border-b border-slate-400 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 text-balance">
            Xét duyệt kết quả nghiên cứu web
          </h3>
          <p className="mt-1 flex flex-wrap gap-1 text-xs text-slate-700">
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

      <div className="flex flex-wrap gap-1.5 border-b border-slate-400 px-4 py-2">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setStatusFilter(filter.id)}
            aria-pressed={statusFilter === filter.id}
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
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-400 bg-slate-50 px-4 py-2">
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
            <span className="text-xs text-slate-700">
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
              disabled={jobConfidentCandidates === 0}
              onClick={approveConfident}
            >
              Duyệt các dòng đủ tin cậy (≥{" "}
              {Math.round(BULK_MIN_CONFIDENCE * 100)}%)
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto border-b border-slate-400 lg:max-h-[40rem] lg:border-b-0 lg:border-r">
          {isTruncated ? (
            <p className="bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Hiển thị {rows.length.toLocaleString("vi-VN")}/
              {listTotal.toLocaleString("vi-VN")} dòng. Lọc theo trạng thái để
              xem các dòng còn lại.
            </p>
          ) : null}
          {rows.map((row) => {
            const meta = ROW_STATUS_META[row.status];
            const isSelected = row.rowNumber === selectedRowNumber;
            const isApprovable = BULK_APPROVABLE_STATUSES.includes(row.status);
            const pct = confidencePercent(row.confidenceScore);
            return (
              <div
                key={row.id}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-violet-50" : "hover:bg-slate-100"
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
                  aria-selected={isSelected}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {row.productName || `Dòng ${row.rowNumber}`}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-700">
                      <span>Dòng {row.rowNumber}</span>
                      {pct != null ? (
                        <span
                          className={`font-semibold tabular-nums ${
                            pct >= 85
                              ? "text-emerald-700"
                              : pct >= 50
                                ? "text-amber-700"
                                : "text-slate-700"
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
              compare={compare}
              isDetailLoading={isDetailLoading}
              isApproving={isApproving}
              isRejecting={isRejecting}
              onApprove={(decision) =>
                onApprove(selectedRow.rowNumber, decision)
              }
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
  compare,
  isDetailLoading,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
}: {
  row: ExcelResearchRowSummary;
  evidence: ExcelResearchRowEvidence[];
  compare: ExcelResearchCompare | null;
  isDetailLoading: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: (decision: ResearchApproveDecision) => void;
  onReject: () => void;
}) {
  const meta = ROW_STATUS_META[row.status];
  const [failedImageIds, setFailedImageIds] = useState<Set<number>>(
    () => new Set(),
  );
  const canDecide =
    row.status === "needs_review" ||
    row.status === "matched" ||
    row.status === "pending";

  // Local decision state, seeded from the persisted compare payload whenever the
  // selected row changes. The web-research row already stored found values +
  // accepted/overwrite/edited sets, so re-entering a row restores prior edits.
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(
    null,
  );
  const [accepted, setAccepted] = useState<Set<FillableField>>(() => new Set());
  const [overwrite, setOverwrite] = useState<Set<FillableField>>(
    () => new Set(),
  );
  const [editedValues, setEditedValues] = useState<
    Partial<Record<FillableField, string>>
  >({});

  // Manual catalog re-pick: same debounced search the step-2 chooser uses.
  const [searchTerm, setSearchTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);
  const searchQuery = api.material.enrichSearchMaterials.useQuery(
    { query: debounced },
    { enabled: debounced.length > 0 },
  );

  // Re-seed whenever we switch rows or the server returns fresh compare data.
  // Keyed on rowNumber so editing one row, then returning, restores its state.
  useEffect(() => {
    setSelectedMaterialId(compare?.matchedMaterialId ?? null);
    setAccepted(new Set(compare?.acceptedFields ?? []));
    setOverwrite(new Set(compare?.overwriteFields ?? []));
    setEditedValues({ ...(compare?.editedFields ?? {}) });
    setSearchTerm("");
    setDebounced("");
  }, [row.rowNumber, compare]);

  const sheetFields = compare?.sheetFields ?? {};
  const foundFields = compare?.foundFields ?? {};

  const showingSearch = debounced.length > 0;
  const candidates = (searchQuery.data?.candidates ?? []) as EnrichCandidate[];

  const toggleField = (field: FillableField) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
        setOverwrite((o) => {
          if (!o.has(field)) return o;
          const no = new Set(o);
          no.delete(field);
          return no;
        });
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const toggleOverwrite = (field: FillableField) => {
    setOverwrite((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
        setAccepted((a) => {
          if (!a.has(field)) return a;
          const na = new Set(a);
          na.delete(field);
          return na;
        });
      } else {
        next.add(field);
        setAccepted((a) => new Set(a).add(field));
      }
      return next;
    });
  };

  const editValue = (field: FillableField, value: string) => {
    setEditedValues((prev) => ({ ...prev, [field]: value }));
    setAccepted((a) => new Set(a).add(field));
  };

  const choose = (candidate: EnrichCandidate) => {
    setSelectedMaterialId(candidate.materialId);
    // Re-pick keeps the user's accepted/edited choices; the editor recomputes
    // the plan against the new candidate's fields.
  };

  const clear = () => {
    setSelectedMaterialId(null);
    setAccepted(new Set());
    setOverwrite(new Set());
    setEditedValues({});
  };

  const approve = () => {
    onApprove({
      materialId: selectedMaterialId ?? undefined,
      acceptedFields: Array.from(accepted),
      overwriteFields: Array.from(overwrite),
      editedValues,
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-400 bg-slate-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
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

      {/* Compare + per-field accept / overwrite / inline edit. Manual catalog
          re-pick swaps the fill base to the chosen material; with no pick the
          plan is driven by the web-found values. */}
      {isDetailLoading ? (
        <p className="text-xs text-slate-700">Đang tải kết quả…</p>
      ) : (
        <FieldCompareEditor
          sheetLabel={`Dòng Excel ${row.rowNumber}`}
          sheetName={row.productName ?? ""}
          sheetFields={sheetFields}
          proposedFields={foundFields}
          selectedMaterialId={selectedMaterialId}
          accepted={accepted}
          overwrite={overwrite}
          editedValues={editedValues}
          onToggleField={toggleField}
          onToggleOverwrite={toggleOverwrite}
          onEditValue={editValue}
          onClear={clear}
          enableCandidateGrid
          candidates={candidates}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          isSearching={searchQuery.isLoading}
          showingSearch={showingSearch}
          onChoose={choose}
          enableInlineEdit
          clearLabel="Bỏ ghép catalog (giữ giá trị web)"
        />
      )}

      {/* Evidence stays a read-only gallery — evidence rows lack the full
          material fields needed to act as fill candidates. */}
      {!isDetailLoading && evidence.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">Bằng chứng</p>
          {evidence.map((item) => (
            <div
              key={item.id}
              className="flex gap-2 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-2 text-xs"
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded border border-slate-400 bg-slate-100">
                {item.imageUrl && !failedImageIds.has(item.id) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.title ?? ""}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain"
                    loading="lazy"
                    onError={() =>
                      setFailedImageIds((prev) => {
                        if (prev.has(item.id)) return prev;
                        const next = new Set(prev);
                        next.add(item.id);
                        return next;
                      })
                    }
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
                    className="mt-1 block truncate text-blue-600 hover:underline"
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

      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<ThumbsUp className="h-3.5 w-3.5" />}
            isLoading={isApproving}
            disabled={isRejecting}
            onClick={approve}
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
