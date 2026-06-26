"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Globe, Sparkles } from "lucide-react";

import { MatchChooser } from "~/app/_components/materials/review/match-chooser";
import type {
  ReviewRow,
  ReviewRowStatus,
  ReviewSearchMode,
} from "~/app/_components/materials/review/review-types";
import { STATUS_META } from "~/app/_components/materials/review/status-meta";
import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  applyWebSearchToDecision,
  isExportableDecision,
  webFieldsAfterGapFill,
  type WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  candidateToFields,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { RowDecision } from "~/lib/materials/review-decision";
import { runWithConcurrency } from "~/lib/run-with-concurrency";
import { api } from "~/trpc/react";

export type ReviewPanelSummary = {
  totalRows: number;
  auto: number;
  review: number;
  unmatched: number;
};

function webRowInput(row: ReviewRow) {
  return {
    name: row.name,
    code: row.sheetFields.code,
    manufacturer: row.sheetFields.manufacturer,
    specText: row.sheetFields.specText,
    unit: row.sheetFields.unit,
    category: row.sheetFields.category,
  };
}

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
  onFlushDecisionsForRows,
  searchMode = "default",
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
  onFlushDecisionsForRows?: (rowIndices: number[]) => void;
  searchMode?: ReviewSearchMode;
}) {
  const toast = useToast();
  const isProfileSplit = searchMode === "profileSplit";
  const webSearch = api.material.enrichWebSearchRow.useMutation();
  const webLinksSearch = api.material.enrichWebSearchRowLinks.useMutation();
  const aiSearchSingle = api.material.enrichAiSearchRow.useMutation();
  const selectedRowIndexRef = useRef(selectedRowIndex);
  selectedRowIndexRef.current = selectedRowIndex;

  const [checkedRows, setCheckedRows] = useState<Set<number>>(() => new Set());
  const [bulkProgress, setBulkProgress] = useState<{
    kind: "web" | "ai";
    completed: number;
    total: number;
  } | null>(null);

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

  useEffect(() => {
    setCheckedRows((prev) => {
      const valid = new Set(rows.map((row) => row.originalRowIndex));
      const next = new Set<number>();
      for (const rowIndex of prev) {
        if (valid.has(rowIndex)) next.add(rowIndex);
      }
      return next;
    });
  }, [rows]);

  if (rows.length === 0) {
    return (
      <section className="panel p-2">
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
    (decision) =>
      decision.webSearchStatus === "pending" ||
      decision.webLinksStatus === "pending",
  ).length;
  const aiPendingCount = Array.from(decisions.values()).filter(
    (decision) => decision.aiSearchStatus === "pending",
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

  const resolveTargetRows = (): ReviewRow[] => {
    if (checkedRows.size > 0) {
      return rows.filter((row) => checkedRows.has(row.originalRowIndex));
    }
    return filtered;
  };

  const toggleRowChecked = (rowIndex: number, checked: boolean) => {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  };

  const toggleAllFiltered = (checked: boolean) => {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      for (const row of filtered) {
        if (checked) next.add(row.originalRowIndex);
        else next.delete(row.originalRowIndex);
      }
      return next;
    });
  };

  const allFilteredChecked =
    filtered.length > 0 &&
    filtered.every((row) => checkedRows.has(row.originalRowIndex));

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

    webSearch.mutate(webRowInput(row), {
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
    });
  };

  const runWebLinksForRow = async (row: ReviewRow) => {
    const rowIndex = row.originalRowIndex;
    const decision = decisions.get(rowIndex) ?? {
      materialId: null,
      acceptedFields: new Set<FillableField>(),
    };
    const nextPending = {
      ...decision,
      webLinksStatus: "pending" as const,
      webLinkResults: [],
    };
    updateDecision(rowIndex, nextPending);
    persistDecision(rowIndex, nextPending);

    try {
      const response = await webLinksSearch.mutateAsync(webRowInput(row));
      const links: WebLinkResult[] = response.results.map((hit) => ({
        title: hit.title,
        url: hit.url,
        domain: hit.domain,
        snippet: hit.snippet,
        query: hit.query,
        rankScore: hit.rankScore,
      }));
      const status = links.length > 0 ? ("done" as const) : ("error" as const);
      applyDecisions((prev) => {
        const current = prev.get(rowIndex);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(rowIndex, {
          ...current,
          webLinkResults: links,
          webLinksStatus: status,
        });
        persistDecision(rowIndex, next.get(rowIndex)!);
        return next;
      });
      if (rowIndex === selectedRowIndexRef.current) {
        if (links.length === 0) {
          toast.warning("Không tìm thấy liên kết web.");
        } else {
          toast.success(`Tìm thấy ${links.length} liên kết web.`);
        }
      }
    } catch (error) {
      applyDecisions((prev) => {
        const current = prev.get(rowIndex);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(rowIndex, { ...current, webLinksStatus: "error" });
        persistDecision(rowIndex, next.get(rowIndex)!);
        return next;
      });
      if (rowIndex === selectedRowIndexRef.current) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Không tìm được liên kết web.",
        );
      }
      throw error;
    }
  };

  const runAiSearchForRow = async (row: ReviewRow) => {
    const rowIndex = row.originalRowIndex;
    const decision = decisions.get(rowIndex) ?? {
      materialId: null,
      acceptedFields: new Set<FillableField>(),
    };
    const nextPending = {
      ...decision,
      aiSearchStatus: "pending" as const,
      aiSearchCandidates: [],
    };
    updateDecision(rowIndex, nextPending);
    persistDecision(rowIndex, nextPending);

    try {
      let links = decision.webLinkResults ?? [];
      if (links.length === 0) {
        const response = await webLinksSearch.mutateAsync(webRowInput(row));
        links = response.results.map((hit) => ({
          title: hit.title,
          url: hit.url,
          domain: hit.domain,
          snippet: hit.snippet,
          query: hit.query,
          rankScore: hit.rankScore,
        }));
        applyDecisions((prev) => {
          const current = prev.get(rowIndex);
          if (!current) return prev;
          const next = new Map(prev);
          next.set(rowIndex, {
            ...current,
            webLinkResults: links,
            webLinksStatus: links.length > 0 ? "done" : "error",
          });
          persistDecision(rowIndex, next.get(rowIndex)!);
          return next;
        });
      }

      const topLinks = links.slice(0, 6);
      if (topLinks.length === 0) {
        applyDecisions((prev) => {
          const current = prev.get(rowIndex);
          if (!current) return prev;
          const next = new Map(prev);
          next.set(rowIndex, { ...current, aiSearchStatus: "error" });
          persistDecision(rowIndex, next.get(rowIndex)!);
          return next;
        });
        if (rowIndex === selectedRowIndexRef.current) {
          toast.warning("Không có nguồn web để trích xuất AI.");
        }
        return;
      }

      const rowInput = webRowInput(row);
      const extracted = await runWithConcurrency(
        topLinks.map((link) => async () => {
          try {
            const result = await aiSearchSingle.mutateAsync({
              ...rowInput,
              webResults: [
                {
                  title: link.title || link.url,
                  url: link.url,
                  domain: link.domain,
                  snippet: link.snippet,
                  query: link.query,
                  rankScore: link.rankScore,
                },
              ],
            });
            if (Object.keys(result.fields).length === 0) {
              return null;
            }
            return {
              fields: result.fields,
              sourceUrls: result.sourceUrls,
              evidence: result.evidence,
              title: link.title,
              url: link.url,
              snippet: link.snippet,
              rankScore: link.rankScore,
            };
          } catch {
            return null;
          }
        }),
        3,
      );

      const candidates = extracted.filter(
        (item): item is NonNullable<(typeof extracted)[number]> => item != null,
      );
      const status = candidates.length > 0 ? ("done" as const) : ("error" as const);

      applyDecisions((prev) => {
        const current = prev.get(rowIndex);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(rowIndex, {
          ...current,
          aiSearchCandidates: candidates,
          aiSearchResult: candidates[0],
          aiSearchStatus: status,
        });
        persistDecision(rowIndex, next.get(rowIndex)!);
        return next;
      });

      if (rowIndex === selectedRowIndexRef.current) {
        if (candidates.length === 0) {
          toast.warning("AI không trích xuất được ứng viên nào.");
        } else {
          toast.success(`Tìm thấy ${candidates.length} ứng viên AI.`);
        }
      }
    } catch (error) {
      applyDecisions((prev) => {
        const current = prev.get(rowIndex);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(rowIndex, { ...current, aiSearchStatus: "error" });
        persistDecision(rowIndex, next.get(rowIndex)!);
        return next;
      });
      if (rowIndex === selectedRowIndexRef.current) {
        toast.error(
          error instanceof Error ? error.message : "Tìm AI thất bại.",
        );
      }
      throw error;
    }
  };

  const runBulkSearch = async (kind: "web" | "ai") => {
    const targets = resolveTargetRows().filter((row) => row.name.trim());
    if (targets.length === 0) {
      toast.warning("Không có dòng hợp lệ để tìm.");
      return;
    }

    onFlushDecisionsForRows?.(targets.map((row) => row.originalRowIndex));
    setBulkProgress({ kind, completed: 0, total: targets.length });

    try {
      await runWithConcurrency(
        targets.map((row) => () =>
          kind === "web" ? runWebLinksForRow(row) : runAiSearchForRow(row),
        ),
        3,
        (completed, total) => setBulkProgress({ kind, completed, total }),
      );
      toast.success(
        kind === "web"
          ? `Đã tìm web cho ${targets.length} dòng.`
          : `Đã tìm AI cho ${targets.length} dòng.`,
      );
    } catch {
      toast.error(
        kind === "web"
          ? "Một số dòng tìm web thất bại."
          : "Một số dòng tìm AI thất bại.",
      );
    } finally {
      setBulkProgress(null);
    }
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

  const bulkTargetCount = resolveTargetRows().filter((row) =>
    row.name.trim(),
  ).length;
  const isBulkRunning = bulkProgress != null;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-1 border-b border-slate-400 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 text-balance">
            Xét duyệt & chọn sản phẩm
          </h3>
          <p className="mt-1 flex flex-wrap gap-1 text-xs text-slate-700">
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
            {!isProfileSplit ? (
              <span className="tabular-nums">
                {webPendingCount.toLocaleString("vi-VN")} đang tìm web
              </span>
            ) : (
              <>
                <span className="tabular-nums">
                  {webPendingCount.toLocaleString("vi-VN")} đang tìm liên kết
                </span>
                <span className="tabular-nums">
                  {aiPendingCount.toLocaleString("vi-VN")} đang tìm AI
                </span>
              </>
            )}
            <span className="tabular-nums">
              {savedToMaterialsCount.toLocaleString("vi-VN")} đã lưu vật tư
            </span>
          </p>
        </div>
        {headerActions ? (
          <div className="flex flex-wrap gap-2">{headerActions}</div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-400 px-4 py-2">
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
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {isProfileSplit ? (
            <>
              {bulkProgress ? (
                <span className="text-xs text-slate-600">
                  {bulkProgress.kind === "web" ? "Đang tìm web" : "Đang tìm AI"}:{" "}
                  {bulkProgress.completed}/{bulkProgress.total}
                </span>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={bulkTargetCount === 0 || isBulkRunning}
                onClick={() => void runBulkSearch("web")}
              >
                <Globe className="h-4 w-4" aria-hidden />
                Tìm web ({bulkTargetCount.toLocaleString("vi-VN")})
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={bulkTargetCount === 0 || isBulkRunning}
                onClick={() => void runBulkSearch("ai")}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Tìm AI ({bulkTargetCount.toLocaleString("vi-VN")})
              </Button>
            </>
          ) : null}
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
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto border-b border-slate-400 lg:max-h-[40rem] lg:border-b-0 lg:border-r">
          {isProfileSplit && filtered.length > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={allFilteredChecked}
                onChange={(event) => toggleAllFiltered(event.target.checked)}
                className="h-4 w-4 rounded border-slate-400"
              />
              Chọn tất cả ({filtered.length.toLocaleString("vi-VN")})
            </label>
          ) : null}
          {filtered.map((row) => {
            const meta = STATUS_META[row.status];
            const decision = decisions.get(row.originalRowIndex);
            const isSelected = row.originalRowIndex === selectedRowIndex;
            const name = row.name.trim()
              ? row.name
              : (row.topCandidate?.name ?? `Dòng ${row.originalRowIndex}`);
            return (
              <div
                key={row.originalRowIndex}
                className={`flex w-full items-start gap-2 px-3 py-2.5 transition-colors ${
                  isSelected ? "bg-blue-50" : "hover:bg-slate-100"
                }`}
              >
                {isProfileSplit ? (
                  <input
                    type="checkbox"
                    checked={checkedRows.has(row.originalRowIndex)}
                    onChange={(event) =>
                      toggleRowChecked(
                        row.originalRowIndex,
                        event.target.checked,
                      )
                    }
                    onClick={(event) => event.stopPropagation()}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-400"
                    aria-label={`Chọn dòng ${row.originalRowIndex}`}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedRowIndex(row.originalRowIndex)}
                  aria-selected={isSelected}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {!isProfileSplit && decision?.webSearchStatus === "pending" ? (
                      <Badge tone="info">Đang tìm web</Badge>
                    ) : !isProfileSplit && decision?.webSearchStatus === "error" ? (
                      <Badge tone="critical">Web lỗi</Badge>
                    ) : null}
                    {isProfileSplit && decision?.webLinksStatus === "pending" ? (
                      <Badge tone="info">Web…</Badge>
                    ) : isProfileSplit && decision?.webLinksStatus === "error" ? (
                      <Badge tone="critical">Web lỗi</Badge>
                    ) : null}
                    {isProfileSplit && decision?.aiSearchStatus === "pending" ? (
                      <Badge tone="info">AI…</Badge>
                    ) : isProfileSplit && decision?.aiSearchStatus === "error" ? (
                      <Badge tone="critical">AI lỗi</Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-700">
                    Dòng {row.originalRowIndex}
                    {decision?.materialId != null
                      ? ` · đã chọn (${decision.acceptedFields.size} ô)`
                      : decision?.skipped
                        ? " · đã bỏ qua"
                        : decision && isExportableDecision(decision)
                          ? ` · đã điền (${decision.acceptedFields.size} ô)`
                          : !isProfileSplit &&
                              decision?.webSearchStatus === "error"
                            ? " · tìm web thất bại"
                            : row.status === "unmatched"
                              ? " · chưa chọn"
                              : ""}
                  </p>
                </button>
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-700">
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
              searchMode={searchMode}
              onWebSearch={() => handleWebSearch(selectedRow)}
              onWebLinksSearch={() => void runWebLinksForRow(selectedRow)}
              onAiSearch={() => void runAiSearchForRow(selectedRow)}
              isWebSearchPending={
                decisions.get(selectedRow.originalRowIndex)?.webSearchStatus ===
                "pending"
              }
              isWebLinksPending={
                decisions.get(selectedRow.originalRowIndex)?.webLinksStatus ===
                "pending"
              }
              isAiSearchPending={
                decisions.get(selectedRow.originalRowIndex)?.aiSearchStatus ===
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
