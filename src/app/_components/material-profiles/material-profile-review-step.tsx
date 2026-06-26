"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReviewPanel } from "~/app/_components/materials/review/review-panel";
import type { ReviewRowStatus } from "~/app/_components/materials/review/review-types";
import { Button, EmptyState } from "~/app/_components/ui";
import {
  countFieldsToFill,
  countResolvedRows,
  isExportableDecision,
} from "~/lib/materials/enrich-gap-fill";
import {
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
  onContinue,
}: {
  items: WorkspaceItem[];
  workspaceId: number;
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

  const [decisions, setDecisions] = useState<Map<number, RowDecision>>(
    () => seedDecisionsFromItems(reviewItems),
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
  const updateReviewDecision =
    api.materialProfile.updateItemReviewDecision.useMutation();
  const batchUpdateReviewDecisions =
    api.materialProfile.batchUpdateItemReviewDecisions.useMutation({
      onSuccess: () => {
        void utils.materialProfile.get.invalidate({ workspaceId });
      },
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

  const handleContinue = async () => {
    setIsFlushing(true);
    try {
      await flushDecisions();
      onContinue();
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
      if (row.status !== "unmatched") return false;
      const decision = decisions.get(row.originalRowIndex);
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
      applyDecisions={setDecisions}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      selectedRowIndex={selectedRowIndex}
      setSelectedRowIndex={setSelectedRowIndex}
      fieldsToFill={fieldsToFill}
      matchedCount={matchedCount}
      pendingUnmatched={pendingUnmatched}
      onDecisionPersist={handleDecisionPersist}
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
