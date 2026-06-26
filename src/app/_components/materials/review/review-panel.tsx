"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { MatchChooser } from "~/app/_components/materials/review/match-chooser";
import type {
  ReviewRow,
  ReviewRowStatus,
} from "~/app/_components/materials/review/review-types";
import { STATUS_META } from "~/app/_components/materials/review/status-meta";
import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  applyWebSearchToDecision,
  isExportableDecision,
  webFieldsAfterGapFill,
} from "~/lib/materials/enrich-gap-fill";
import {
  candidateToFields,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { RowDecision } from "~/lib/materials/review-decision";
import { api } from "~/trpc/react";

export type ReviewPanelSummary = {
  totalRows: number;
  auto: number;
  review: number;
  unmatched: number;
};

export function ReviewPanel({
  rows,
  summary,
  decisions,
  updateDecision,
  applyDecisions,
  statusFilter,
  setStatusFilter,
  selectedRowIndex,
  setSelectedRowIndex,
  fieldsToFill,
  matchedCount,
  pendingUnmatched,
  headerActions,
  emptyTitle = "Không có dòng để đối chiếu",
  emptyDescription = "File không có dòng dữ liệu hợp lệ với cột tên vật tư đã chọn.",
  onDecisionPersist,
}: {
  rows: ReviewRow[];
  summary: ReviewPanelSummary;
  decisions: Map<number, RowDecision>;
  updateDecision: (rowIndex: number, next: RowDecision) => void;
  applyDecisions: (
    updater: (prev: Map<number, RowDecision>) => Map<number, RowDecision>,
  ) => void;
  statusFilter: ReviewRowStatus | "all";
  setStatusFilter: (value: ReviewRowStatus | "all") => void;
  selectedRowIndex: number | null;
  setSelectedRowIndex: (value: number | null) => void;
  fieldsToFill: number;
  matchedCount: number;
  pendingUnmatched: number;
  headerActions?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  onDecisionPersist?: (rowIndex: number, decision: RowDecision) => void;
}) {
  const toast = useToast();
  const webSearch = api.material.enrichWebSearchRow.useMutation();
  const selectedRowIndexRef = useRef(selectedRowIndex);
  selectedRowIndexRef.current = selectedRowIndex;

  const filtered =
    statusFilter === "all"
      ? rows
      : rows.filter((row) => row.status === statusFilter);

  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some((row) => row.originalRowIndex === selectedRowIndex)) {
      setSelectedRowIndex(filtered[0]!.originalRowIndex);
    }
  }, [filtered, selectedRowIndex, setSelectedRowIndex]);

  if (rows.length === 0) {
    return (
      <section className="panel p-5">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </section>
    );
  }

  const reviewCount = rows.filter((row) => row.status === "review").length;
  const filters: Array<{
    id: ReviewRowStatus | "all";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "Tất cả", count: rows.length },
    { id: "auto", label: STATUS_META.auto.label, count: summary.auto },
    { id: "review", label: STATUS_META.review.label, count: reviewCount },
    {
      id: "unmatched",
      label: STATUS_META.unmatched.label,
      count: pendingUnmatched,
    },
  ];

  const selectedRow =
    rows.find((row) => row.originalRowIndex === selectedRowIndex) ?? null;
  const webPendingCount = Array.from(decisions.values()).filter(
    (decision) => decision.webSearchStatus === "pending",
  ).length;
  const savedToMaterialsCount = Array.from(decisions.values()).filter(
    (decision) => decision.materialId != null,
  ).length;

  const catalogFieldsForRow = (
    row: ReviewRow,
    materialId: number | null,
  ): Partial<Record<FillableField, string>> | null => {
    if (materialId == null) return null;
    const candidate =
      row.candidates.find((c) => c.materialId === materialId) ?? null;
    return candidate ? candidateToFields(candidate) : null;
  };

  const persistDecision = (rowIndex: number, decision: RowDecision) => {
    onDecisionPersist?.(rowIndex, decision);
  };

  const handleWebSearch = (row: ReviewRow) => {
    const rowIndex = row.originalRowIndex;
    const decision = decisions.get(rowIndex) ?? {
      materialId: null,
      acceptedFields: new Set<FillableField>(),
    };
    const nextPending = {
      ...decision,
      webSearchStatus: "pending" as const,
      webEvidence: [],
    };
    updateDecision(rowIndex, nextPending);
    persistDecision(rowIndex, nextPending);

    const catalogFieldsAtStart = catalogFieldsForRow(row, decision.materialId);

    webSearch.mutate(
      {
        name: row.name,
        code: row.sheetFields.code,
        manufacturer: row.sheetFields.manufacturer,
        specText: row.sheetFields.specText,
        unit: row.sheetFields.unit,
        category: row.sheetFields.category,
      },
      {
        onSuccess: (result) => {
          applyDecisions((prev) => {
            const current = prev.get(rowIndex);
            if (!current) return prev;
            const targetRow = rows.find(
              (r) => r.originalRowIndex === rowIndex,
            );
            if (!targetRow) return prev;

            if (Object.keys(result.fields).length === 0) {
              const next = new Map(prev);
              const errored = {
                ...current,
                webSearchStatus: "error" as const,
              };
              next.set(rowIndex, errored);
              persistDecision(rowIndex, errored);
              return next;
            }

            const catalog = catalogFieldsForRow(
              targetRow,
              current.materialId,
            );
            const next = new Map(prev);
            const merged = applyWebSearchToDecision(
              current,
              targetRow.sheetFields,
              catalog,
              result,
            );
            next.set(rowIndex, merged);
            persistDecision(rowIndex, merged);
            return next;
          });

          if (rowIndex === selectedRowIndexRef.current) {
            if (Object.keys(result.fields).length === 0) {
              toast.warning("Không tìm thấy thông tin sản phẩm trên web.");
            } else {
              const gapCount = Object.keys(
                webFieldsAfterGapFill(
                  row.sheetFields,
                  catalogFieldsAtStart,
                  result.fields,
                ),
              ).length;
              toast.success(`Đã điền ${gapCount} trường từ web.`);
            }
          }
        },
        onError: (error) => {
          applyDecisions((prev) => {
            const current = prev.get(rowIndex);
            if (!current) return prev;
            const next = new Map(prev);
            const errored = {
              ...current,
              webSearchStatus: "error" as const,
            };
            next.set(rowIndex, errored);
            persistDecision(rowIndex, errored);
            return next;
          });
          if (rowIndex === selectedRowIndexRef.current) {
            toast.error(
              error.message || "Không tìm được thông tin trên web.",
            );
          }
        },
      },
    );
  };

  const confirmAllAuto = () => {
    applyDecisions((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        if (row.status !== "auto" || !row.topCandidate) continue;
        const accepted = new Set<FillableField>(
          row.fillPlan
            .filter((cell) => cell.action === "filled")
            .map((cell) => cell.field),
        );
        const decision = {
          materialId: row.topCandidate.materialId,
          acceptedFields: accepted,
        };
        next.set(row.originalRowIndex, decision);
        persistDecision(row.originalRowIndex, decision);
      }
      return next;
    });
  };

  const skipAllUnmatched = () => {
    applyDecisions((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        if (row.status !== "unmatched") continue;
        if (prev.get(row.originalRowIndex)?.materialId != null) continue;
        const decision = {
          materialId: null,
          acceptedFields: new Set<FillableField>(),
          skipped: true,
        };
        next.set(row.originalRowIndex, decision);
        persistDecision(row.originalRowIndex, decision);
      }
      return next;
    });
  };

  const handleDecisionChange = (rowIndex: number, next: RowDecision) => {
    updateDecision(rowIndex, next);
    persistDecision(rowIndex, next);
  };

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 text-balance">
            Xét duyệt & chọn sản phẩm
          </h3>
          <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="tabular-nums">
              {summary.totalRows.toLocaleString("vi-VN")} dòng
            </span>
            <span className="tabular-nums">
              {matchedCount.toLocaleString("vi-VN")} đã chọn
            </span>
            <span className="tabular-nums">
              {fieldsToFill.toLocaleString("vi-VN")} ô sẽ điền
            </span>
            <span className="tabular-nums">
              {pendingUnmatched.toLocaleString("vi-VN")} chưa khớp
            </span>
            <span className="tabular-nums">
              {webPendingCount.toLocaleString("vi-VN")} đang tìm web
            </span>
            <span className="tabular-nums">
              {savedToMaterialsCount.toLocaleString("vi-VN")} đã lưu vật tư
            </span>
          </p>
        </div>
        {headerActions ? (
          <div className="flex flex-wrap gap-2">{headerActions}</div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <div className="flex flex-wrap gap-1.5">
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
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={summary.auto === 0}
            onClick={confirmAllAuto}
          >
            Xác nhận tất cả ≥ 85%
          </Button>
          <Button
            variant="warning"
            size="sm"
            disabled={pendingUnmatched === 0}
            onClick={skipAllUnmatched}
          >
            Bỏ qua chưa khớp
            {pendingUnmatched > 0
              ? ` (${pendingUnmatched.toLocaleString("vi-VN")})`
              : ""}
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto border-b border-slate-200 lg:max-h-[40rem] lg:border-b-0 lg:border-r">
          {filtered.map((row) => {
            const meta = STATUS_META[row.status];
            const decision = decisions.get(row.originalRowIndex);
            const isSelected = row.originalRowIndex === selectedRowIndex;
            const name = row.name.trim()
              ? row.name
              : (row.topCandidate?.name ?? `Dòng ${row.originalRowIndex}`);
            return (
              <button
                key={row.originalRowIndex}
                type="button"
                onClick={() => setSelectedRowIndex(row.originalRowIndex)}
                aria-selected={isSelected}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-sky-50" : "hover:bg-slate-50"
                }`}
              >
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {decision?.webSearchStatus === "pending" ? (
                  <Badge tone="info">Đang tìm web</Badge>
                ) : decision?.webSearchStatus === "error" ? (
                  <Badge tone="critical">Web lỗi</Badge>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Dòng {row.originalRowIndex}
                    {decision?.materialId != null
                      ? ` · đã chọn (${decision.acceptedFields.size} ô)`
                      : decision?.skipped
                        ? " · đã bỏ qua"
                        : decision && isExportableDecision(decision)
                          ? ` · đã điền (${decision.acceptedFields.size} ô)`
                          : decision?.webSearchStatus === "error"
                            ? " · tìm web thất bại"
                            : row.status === "unmatched"
                              ? " · chưa chọn"
                              : ""}
                  </p>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              Không có dòng nào ở bộ lọc này.
            </p>
          ) : null}
        </div>

        <div className="min-w-0 p-4">
          {selectedRow ? (
            <MatchChooser
              key={selectedRow.originalRowIndex}
              row={selectedRow}
              decision={decisions.get(selectedRow.originalRowIndex)}
              onChange={(next) =>
                handleDecisionChange(selectedRow.originalRowIndex, next)
              }
              onWebSearch={() => handleWebSearch(selectedRow)}
              isWebSearchPending={
                decisions.get(selectedRow.originalRowIndex)?.webSearchStatus ===
                "pending"
              }
            />
          ) : (
            <EmptyState
              title="Chọn một dòng"
              description="Chọn một dòng ở danh sách bên trái để xem ứng viên ghép."
            />
          )}
        </div>
      </div>
    </section>
  );
}
