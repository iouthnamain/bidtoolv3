"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReviewPanel } from "~/app/_components/materials/review/review-panel";
import type { ReviewRowStatus } from "~/app/_components/materials/review/review-types";
import { Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  countFieldsToFill,
  countResolvedRows,
  isExportableDecision,
} from "~/lib/materials/enrich-gap-fill";
import {
  catalogDecisionForRow,
  searchResultDecisionForRow,
} from "~/lib/materials/profile-review-bulk-apply";
import {
  deriveReviewRowStatus,
  seedDecisionsFromItems,
  serializeRowDecision,
  type RowDecision,
} from "~/lib/materials/review-decision";
import {
  reviewSummaryFromRows,
  workspaceItemToReviewRow,
  type WorkspaceItemForReview,
} from "~/lib/materials/workspace-review-row";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkspaceItem = RouterOutputs["materialProfile"]["get"]["items"][number];

function toReviewItem(item: WorkspaceItem): WorkspaceItemForReview & {
  materialId: number | null;
  matchStatus: WorkspaceItem["matchStatus"];
  reviewDecisionJson: unknown;
} {
  return {
    id: item.id,
    originalRowIndex: item.originalRowIndex,
    productName: item.productName,
    specText: item.specText,
    unit: item.unit,
    vendorHint: item.vendorHint,
    originHint: item.originHint,
    unitPrice: item.unitPrice,
    currency: item.currency,
    originalDataJson: item.originalDataJson,
    enrichedSnapshotJson: item.enrichedSnapshotJson,
    materialId: item.materialId,
    matchStatus: item.matchStatus,
    reviewDecisionJson: item.reviewDecisionJson,
  };
}

export function MaterialProfileReviewStep({
  items,
  workspaceId,
  bulkApplyUndoAvailable = false,
  onContinue,
}: {
  items: WorkspaceItem[];
  workspaceId: number;
  bulkApplyUndoAvailable?: boolean;
  onContinue: () => void;
}) {
  const itemsKey = useMemo(
    () => items.map((item) => item.id).join(","),
    [items],
  );
  const reviewItems = useMemo(() => items.map(toReviewItem), [items]);
  const reviewRows = useMemo(
    () => reviewItems.map((item) => workspaceItemToReviewRow(item)),
    [reviewItems],
  );
  const reviewSummary = useMemo(
    () => ({
      totalRows: reviewRows.length,
      ...reviewSummaryFromRows(reviewRows),
    }),
    [reviewRows],
  );
  const itemIdByRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of items) {
      map.set(item.originalRowIndex, item.id);
    }
    return map;
  }, [items]);

  const [decisions, setDecisions] = useState<Map<number, RowDecision>>(() =>
    seedDecisionsFromItems(reviewItems),
  );
  const [statusFilter, setStatusFilter] = useState<ReviewRowStatus | "all">(
    "all",
  );
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(
    () => reviewRows[0]?.originalRowIndex ?? null,
  );
  const [isFlushing, setIsFlushing] = useState(false);

  const persistTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;

  const utils = api.useUtils();
  const toast = useToast();
  const updateReviewDecision =
    api.materialProfile.updateItemReviewDecision.useMutation({
      onSuccess: () => {
        void utils.materialProfile.get.invalidate({ workspaceId });
      },
      onError: (error) =>
        toast.error(error.message || "Không lưu được quyết định."),
    });
  const batchUpdateReviewDecisions =
    api.materialProfile.batchUpdateItemReviewDecisions.useMutation({
      onSuccess: () => {
        void utils.materialProfile.get.invalidate({ workspaceId });
      },
      onError: (error) =>
        toast.error(error.message || "Không lưu được quyết định hàng loạt."),
    });
  const bulkApplyMatches = api.materialProfile.bulkApplyMatches.useMutation({
    onSuccess: () => {
      void utils.materialProfile.get.invalidate({ workspaceId });
    },
    onError: (error) =>
      toast.error(error.message || "Không bulk apply được."),
  });
  const undoLastBulkApply = api.materialProfile.undoLastBulkApply.useMutation({
    onSuccess: () => {
      void utils.materialProfile.get.invalidate({ workspaceId });
    },
    onError: (error) =>
      toast.error(error.message || "Không hoàn tác được bulk apply."),
  });

  useEffect(() => {
    setDecisions(seedDecisionsFromItems(reviewItems));
    setSelectedRowIndex(reviewRows[0]?.originalRowIndex ?? null);
  }, [itemsKey]);

  useEffect(
    () => () => {
      for (const timer of persistTimers.current.values()) {
        clearTimeout(timer);
      }
    },
    [],
  );

  const persistDecision = useCallback(
    (rowIndex: number, decision: RowDecision) => {
      const itemId = itemIdByRowIndex.get(rowIndex);
      if (!itemId) return;

      const existing = persistTimers.current.get(rowIndex);
      if (existing) clearTimeout(existing);

      persistTimers.current.set(
        rowIndex,
        setTimeout(() => {
          persistTimers.current.delete(rowIndex);
          updateReviewDecision.mutate({
            itemId,
            decision: serializeRowDecision(decision),
          });
        }, 500),
      );
    },
    [itemIdByRowIndex, updateReviewDecision],
  );

  const flushDecisionsForRows = useCallback(
    (rowIndices: number[]) => {
      for (const rowIndex of rowIndices) {
        const timer = persistTimers.current.get(rowIndex);
        if (timer) {
          clearTimeout(timer);
          persistTimers.current.delete(rowIndex);
        }
        const decision = decisionsRef.current.get(rowIndex);
        const itemId = itemIdByRowIndex.get(rowIndex);
        if (decision && itemId) {
          updateReviewDecision.mutate({
            itemId,
            decision: serializeRowDecision(decision),
          });
        }
      }
    },
    [itemIdByRowIndex, updateReviewDecision],
  );

  const updateDecision = useCallback(
    (rowIndex: number, next: RowDecision) => {
      setDecisions((prev) => {
        const map = new Map(prev);
        map.set(rowIndex, next);
        return map;
      });
    },
    [],
  );

  const handleDecisionPersist = useCallback(
    (rowIndex: number, decision: RowDecision) => {
      persistDecision(rowIndex, decision);
    },
    [persistDecision],
  );

  const flushDecisions = useCallback(async () => {
    for (const timer of persistTimers.current.values()) {
      clearTimeout(timer);
    }
    persistTimers.current.clear();

    const payload = items
      .map((item) => {
        const decision =
          decisionsRef.current.get(item.originalRowIndex) ??
          seedDecisionsFromItems([toReviewItem(item)]).get(
            item.originalRowIndex,
          );
        if (!decision) return null;
        return {
          itemId: item.id,
          decision: serializeRowDecision(decision),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);

    if (payload.length === 0) return;
    await batchUpdateReviewDecisions.mutateAsync({
      workspaceId,
      decisions: payload,
    });
  }, [batchUpdateReviewDecisions, items, workspaceId]);

  const applyDecisions = useCallback(
    (updater: (prev: Map<number, RowDecision>) => Map<number, RowDecision>) => {
      setDecisions(updater);
    },
    [],
  );

  const handleBulkApplyCatalog = useCallback(
    async (rowIndices: number[]) => {
      const eligible = rowIndices
        .map((rowIndex) => {
          const row = reviewRows.find(
            (item) => item.originalRowIndex === rowIndex,
          );
          const itemId = itemIdByRowIndex.get(rowIndex);
          if (!row || itemId == null) return null;
          const decision = catalogDecisionForRow(row);
          if (!decision) return null;
          return { rowIndex, itemId, decision };
        })
        .filter(
          (entry): entry is NonNullable<typeof entry> => entry != null,
        );

      if (eligible.length === 0) {
        toast.warning("Không có dòng đã chọn đạt ngưỡng ≥ 85%.");
        return;
      }

      flushDecisionsForRows(rowIndices);

      try {
        const result = await bulkApplyMatches.mutateAsync({
          workspaceId,
          itemIds: eligible.map((entry) => entry.itemId),
        });

        applyDecisions((prev) => {
          const next = new Map(prev);
          for (const entry of eligible) {
            const existing = prev.get(entry.rowIndex);
            next.set(entry.rowIndex, {
              ...entry.decision,
              webLinkResults: existing?.webLinkResults,
              webLinksStatus: existing?.webLinksStatus,
              aiSearchResult: existing?.aiSearchResult,
              aiSearchCandidates: existing?.aiSearchCandidates,
              aiSearchStatus: existing?.aiSearchStatus,
              catalogPdfUrls: existing?.catalogPdfUrls,
            });
          }
          return next;
        });

        await batchUpdateReviewDecisions.mutateAsync({
          workspaceId,
          decisions: eligible.map((entry) => ({
            itemId: entry.itemId,
            decision: serializeRowDecision(entry.decision),
          })),
        });

        toast.success(
          `Đã áp dụng ${result.summary.appliedCount.toLocaleString("vi-VN")} dòng (≥ 85%).`,
        );
      } catch {
        // Errors surfaced by mutation onError.
      }
    },
    [
      applyDecisions,
      batchUpdateReviewDecisions,
      bulkApplyMatches,
      flushDecisionsForRows,
      itemIdByRowIndex,
      reviewRows,
      toast,
      workspaceId,
    ],
  );

  const handleBulkApplySearchResults = useCallback(
    (rowIndices: number[]) => {
      let appliedCount = 0;
      applyDecisions((prev) => {
        const next = new Map(prev);
        for (const rowIndex of rowIndices) {
          const row = reviewRows.find(
            (item) => item.originalRowIndex === rowIndex,
          );
          const current = prev.get(rowIndex);
          if (!row || !current) continue;
          const applied = searchResultDecisionForRow(row, current);
          if (!applied) continue;
          next.set(rowIndex, applied);
          persistDecision(rowIndex, applied);
          appliedCount += 1;
        }
        return next;
      });

      if (appliedCount === 0) {
        toast.warning("Không có kết quả tìm kiếm để áp dụng trên các dòng đã chọn.");
        return;
      }
      toast.success(
        `Đã áp dụng kết quả tìm kiếm cho ${appliedCount.toLocaleString("vi-VN")} dòng.`,
      );
    },
    [applyDecisions, persistDecision, reviewRows, toast],
  );

  const handleUndoBulkApply = useCallback(async () => {
    try {
      const result = await undoLastBulkApply.mutateAsync({ workspaceId });
      toast.success(
        `Đã hoàn tác bulk apply (${result.restoredCount.toLocaleString("vi-VN")} dòng).`,
      );
    } catch {
      // Errors surfaced by mutation onError.
    }
  }, [toast, undoLastBulkApply, workspaceId]);

  const handleContinue = async () => {
    setIsFlushing(true);
    try {
      await flushDecisions();
      onContinue();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Không lưu được quyết định trước khi tiếp tục.",
      );
    } finally {
      setIsFlushing(false);
    }
  };

  const fieldsToFill = useMemo(
    () => countFieldsToFill(decisions.values()),
    [decisions],
  );
  const matchedCount = useMemo(
    () => countResolvedRows(decisions.values()),
    [decisions],
  );
  const pendingUnmatched = useMemo(() => {
    return reviewRows.filter((row) => {
      const decision = decisions.get(row.originalRowIndex);
      const rowStatus = deriveReviewRowStatus(
        decision,
        row.status,
        row.topCandidate?.materialId ?? null,
      );
      if (rowStatus !== "unmatched") return false;
      if (decision?.skipped) return false;
      return !isExportableDecision(
        decision ?? { materialId: null, acceptedFields: new Set() },
      );
    }).length;
  }, [decisions, reviewRows]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="Chưa có kết quả match"
        description="Quay lại bước 2, lưu mapping rồi chạy match để tạo danh sách duyệt."
      />
    );
  }

  return (
    <ReviewPanel
      rows={reviewRows}
      summary={reviewSummary}
      decisions={decisions}
      updateDecision={updateDecision}
      applyDecisions={applyDecisions}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      selectedRowIndex={selectedRowIndex}
      setSelectedRowIndex={setSelectedRowIndex}
      fieldsToFill={fieldsToFill}
      matchedCount={matchedCount}
      pendingUnmatched={pendingUnmatched}
      onDecisionPersist={handleDecisionPersist}
      onFlushDecisionsForRows={flushDecisionsForRows}
      searchMode="profileSplit"
      onProfileBulkApplyCatalog={handleBulkApplyCatalog}
      onProfileBulkApplySearchResults={handleBulkApplySearchResults}
      onProfileUndoBulkApply={handleUndoBulkApply}
      profileBulkApplyPending={
        bulkApplyMatches.isPending || batchUpdateReviewDecisions.isPending
      }
      profileUndoPending={undoLastBulkApply.isPending}
      profileUndoAvailable={bulkApplyUndoAvailable}
      emptyTitle="Chưa có kết quả match"
      emptyDescription="Quay lại bước 2, lưu mapping rồi chạy match để tạo danh sách duyệt."
      headerActions={
        <Button
          variant="primary"
          size="sm"
          disabled={isFlushing || batchUpdateReviewDecisions.isPending}
          isLoading={isFlushing || batchUpdateReviewDecisions.isPending}
          onClick={() => void handleContinue()}
        >
          Qua preview export
        </Button>
      }
    />
  );
}
