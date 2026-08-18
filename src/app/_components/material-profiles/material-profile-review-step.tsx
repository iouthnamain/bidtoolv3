"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ReviewPanel,
  type ProfileSearchJobPanelState,
  type ProfileSearchRunPanelState,
} from "~/app/_components/materials/review/review-panel";
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
  deserializeRowDecision,
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

const PROFILE_SEARCH_POLL_MS = 2_000;

function isProfileSearchJobActive(
  job: Pick<ProfileSearchJobPanelState, "status"> | null | undefined,
) {
  return job?.status === "queued" || job?.status === "running";
}

function isProfileSearchJobTerminal(
  job: Pick<ProfileSearchJobPanelState, "status"> | null | undefined,
) {
  return (
    job?.status === "completed" ||
    job?.status === "failed" ||
    job?.status === "cancelled"
  );
}

function isMergeableSearchRun(run: ProfileSearchRunPanelState) {
  return (
    run.status === "completed" ||
    run.status === "partial" ||
    run.status === "failed"
  );
}

function mergeDecisionWithSearchRun(
  decision: RowDecision,
  run: ProfileSearchRunPanelState,
): RowDecision {
  const aiSearchResult = run.aiSearchCandidates[0];
  return {
    ...decision,
    webLinkResults: run.webLinkResults,
    webLinksStatus: run.webLinksStatus,
    aiSearchCandidates: run.aiSearchCandidates,
    aiSearchResult,
    aiSearchStatus: run.aiSearchStatus,
    selectedSearchCandidateKey:
      typeof decision.selectedSearchCandidateKey === "string"
        ? decision.selectedSearchCandidateKey
        : undefined,
    catalogPdfUrls: decision.catalogPdfUrls,
  };
}

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
    linkedCatalogPdfUrls: (item.profileResolution.candidate.evidenceUrls ?? [])
      .map((url) => url?.trim() ?? "")
      .filter(Boolean),
    linkedMaterial:
      item.materialId == null
        ? undefined
        : {
            id: item.materialId,
            name:
              item.profileResolution.candidate.name?.trim() ?? item.productName,
            code: item.profileResolution.candidate.code,
            unit: item.profileResolution.candidate.unit,
            specText: item.profileResolution.candidate.specText,
            manufacturer: item.profileResolution.candidate.manufacturer,
            originCountry: item.profileResolution.candidate.originCountry,
            defaultUnitPrice: item.profileResolution.candidate.unitPrice,
            sourceUrl: item.profileResolution.candidate.sourceUrl,
          },
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
  const rowIndicesKey = useMemo(
    () => items.map((item) => item.originalRowIndex).join(","),
    [items],
  );
  const reviewItems = useMemo(() => items.map(toReviewItem), [items]);
  const reviewRows = useMemo(
    () => reviewItems.map((item) => workspaceItemToReviewRow(item)),
    [reviewItems],
  );
  const reviewRowByIndex = useMemo(
    () => new Map(reviewRows.map((row) => [row.originalRowIndex, row])),
    [reviewRows],
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
  const [isProfileCapturePending, setIsProfileCapturePending] = useState(false);

  const persistTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const previousActiveSearchJobIdRef = useRef<string | null>(null);
  const invalidatedTerminalSearchJobKeyRef = useRef<string | null>(null);
  const selectedWorkspaceIdRef = useRef<number | null>(null);
  const seededRowsKeyRef = useRef<string | null>(null);
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
      toast.error(error.message || "Không áp dụng hàng loạt được."),
  });
  const undoLastBulkApply = api.materialProfile.undoLastBulkApply.useMutation({
    onSuccess: () => {
      void utils.materialProfile.get.invalidate({ workspaceId });
    },
    onError: (error) =>
      toast.error(error.message || "Không hoàn tác được bulk apply."),
  });
  const searchJobsQuery = api.materialProfile.listSearchJobs.useQuery(
    { workspaceId, limit: 5 },
    {
      refetchInterval: (query) => {
        const jobs = query.state.data ?? [];
        return jobs.some(isProfileSearchJobActive)
          ? PROFILE_SEARCH_POLL_MS
          : false;
      },
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const latestProfileSearchJob = searchJobsQuery.data?.[0] ?? null;
  const activeProfileSearchJob =
    searchJobsQuery.data?.find(isProfileSearchJobActive) ?? null;
  const selectedItemId =
    selectedRowIndex == null
      ? null
      : (itemIdByRowIndex.get(selectedRowIndex) ?? null);
  const searchRunsQuery = api.materialProfile.listSearchRuns.useQuery(
    {
      workspaceId,
      itemId: selectedItemId ?? undefined,
      limit: 10,
    },
    {
      enabled: selectedItemId != null,
      refetchInterval: () =>
        activeProfileSearchJob ? PROFILE_SEARCH_POLL_MS : false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const activeSearchRunsQuery = api.materialProfile.listSearchRuns.useQuery(
    {
      workspaceId,
      jobId: activeProfileSearchJob?.id,
      limit: Math.max(1, Math.min(activeProfileSearchJob?.total ?? 1, 500)),
    },
    {
      enabled: activeProfileSearchJob != null,
      refetchInterval: PROFILE_SEARCH_POLL_MS,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const startSearchJob = api.materialProfile.startSearchJob.useMutation({
    onSuccess: async (job) => {
      toast.success(
        job.mode === "web"
          ? `Đã bắt đầu job tìm web cho ${job.total} dòng.`
          : job.mode === "auto"
            ? `Đã bắt đầu thu thập & lưu ${job.total} dòng hợp lệ.`
            : `Đã bắt đầu job tìm AI cho ${job.total} dòng.`,
      );
      await utils.materialProfile.listSearchJobs.invalidate();
      await utils.materialProfile.get.invalidate({ workspaceId });
    },
    onError: (error) =>
      toast.error(error.message || "Không bắt đầu được job tìm kiếm."),
  });
  const cancelSearchJob = api.materialProfile.cancelSearchJob.useMutation({
    onSuccess: async () => {
      toast.success("Đã hủy job tìm kiếm.");
      await utils.materialProfile.listSearchJobs.invalidate();
      await utils.materialProfile.get.invalidate({ workspaceId });
    },
    onError: (error) =>
      toast.error(error.message || "Không hủy được job tìm kiếm."),
  });
  const setCurrentSearchRun =
    api.materialProfile.setCurrentSearchRun.useMutation({
      onSuccess: async () => {
        await utils.materialProfile.listSearchRuns.invalidate();
        await utils.materialProfile.get.invalidate({ workspaceId });
      },
      onError: (error) =>
        toast.error(error.message || "Không dùng lại được lần tìm kiếm."),
    });
  const activeProfileSearchJobId = activeProfileSearchJob?.id ?? null;
  const terminalSearchJobKey =
    latestProfileSearchJob && isProfileSearchJobTerminal(latestProfileSearchJob)
      ? `${latestProfileSearchJob.id}:${latestProfileSearchJob.status}`
      : null;

  useEffect(() => {
    if (activeProfileSearchJobId) {
      previousActiveSearchJobIdRef.current = activeProfileSearchJobId;
      return;
    }
    if (!terminalSearchJobKey) return;
    const wasPreviouslyActive =
      previousActiveSearchJobIdRef.current === latestProfileSearchJob?.id;
    if (
      !wasPreviouslyActive &&
      invalidatedTerminalSearchJobKeyRef.current === terminalSearchJobKey
    ) {
      return;
    }
    previousActiveSearchJobIdRef.current = null;
    invalidatedTerminalSearchJobKeyRef.current = terminalSearchJobKey;
    const decisionsAtRequest = new Map(decisionsRef.current);
    void utils.materialProfile.get
      .fetch({ workspaceId })
      .then((workspace) => {
        setDecisions((previous) => {
          const next = new Map(previous);
          for (const item of workspace.items) {
            const remoteDecision = deserializeRowDecision(
              item.reviewDecisionJson,
            );
            if (!remoteDecision) continue;
            const requestedDecision = decisionsAtRequest.get(
              item.originalRowIndex,
            );
            const currentDecision = previous.get(item.originalRowIndex);
            if (currentDecision !== requestedDecision) continue;
            next.set(item.originalRowIndex, remoteDecision);
          }
          return next;
        });
      })
      .catch(() => {
        // The search-run history remains available if the refresh fails.
      });
  }, [
    activeProfileSearchJobId,
    latestProfileSearchJob?.id,
    terminalSearchJobKey,
    utils.materialProfile.get,
    workspaceId,
  ]);

  useEffect(() => {
    const runs = (activeSearchRunsQuery.data ?? []).filter(
      isMergeableSearchRun,
    );
    if (runs.length === 0) return;

    setDecisions((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const run of runs) {
        if (!reviewRowByIndex.has(run.originalRowIndex)) continue;
        const current = prev.get(run.originalRowIndex) ?? {
          materialId: null,
          acceptedFields: new Set(),
        };
        next.set(
          run.originalRowIndex,
          mergeDecisionWithSearchRun(current, run),
        );
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [activeSearchRunsQuery.data, reviewRowByIndex]);

  useEffect(() => {
    const seedKey = `${workspaceId}:${rowIndicesKey}`;
    if (seededRowsKeyRef.current === seedKey) return;
    seededRowsKeyRef.current = seedKey;
    const seeded = seedDecisionsFromItems(reviewItems);
    setDecisions((current) => {
      const next = new Map<number, RowDecision>();
      for (const [rowIndex, decision] of seeded) {
        next.set(rowIndex, current.get(rowIndex) ?? decision);
      }
      return next;
    });
  }, [reviewItems, rowIndicesKey, workspaceId]);

  useEffect(() => {
    const rowIndices = rowIndicesKey
      .split(",")
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isFinite);
    const requestedRow = Number.parseInt(
      new URLSearchParams(window.location.search).get("row") ?? "",
      10,
    );
    const workspaceChanged = selectedWorkspaceIdRef.current !== workspaceId;
    selectedWorkspaceIdRef.current = workspaceId;
    setSelectedRowIndex((current) => {
      if (workspaceChanged && rowIndices.includes(requestedRow)) {
        return requestedRow;
      }
      return current != null && rowIndices.includes(current)
        ? current
        : (rowIndices[0] ?? null);
    });
  }, [rowIndicesKey, workspaceId]);

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
    async (rowIndices: number[]) => {
      const payload: Array<{
        itemId: number;
        decision: ReturnType<typeof serializeRowDecision>;
      }> = [];
      for (const rowIndex of rowIndices) {
        const timer = persistTimers.current.get(rowIndex);
        if (timer) {
          clearTimeout(timer);
          persistTimers.current.delete(rowIndex);
        }
        const decision = decisionsRef.current.get(rowIndex);
        const itemId = itemIdByRowIndex.get(rowIndex);
        if (decision && itemId) {
          payload.push({
            itemId,
            decision: serializeRowDecision(decision),
          });
        }
      }
      if (payload.length === 0) return;
      await batchUpdateReviewDecisions.mutateAsync({
        workspaceId,
        decisions: payload,
      });
    },
    [batchUpdateReviewDecisions, itemIdByRowIndex, workspaceId],
  );

  const updateDecision = useCallback((rowIndex: number, next: RowDecision) => {
    setDecisions((prev) => {
      const map = new Map(prev);
      map.set(rowIndex, next);
      return map;
    });
  }, []);

  const handleDecisionPersist = useCallback(
    (rowIndex: number, decision: RowDecision) => {
      persistDecision(rowIndex, decision);
    },
    [persistDecision],
  );

  const handleProfileSearchJob = useCallback(
    async (kind: "web" | "ai", rowIndices: number[]) => {
      if (isProfileCapturePending) {
        toast.warning(
          "Chờ thu thập nguồn hiện tại hoàn tất trước khi tìm lại.",
        );
        return;
      }
      const itemIds = rowIndices
        .map((rowIndex) => itemIdByRowIndex.get(rowIndex))
        .filter((itemId): itemId is number => itemId != null);
      if (itemIds.length === 0) {
        toast.warning("Không có dòng hợp lệ để tìm kiếm.");
        return;
      }
      await startSearchJob.mutateAsync({
        workspaceId,
        itemIds,
        mode: kind,
      });
    },
    [
      isProfileCapturePending,
      itemIdByRowIndex,
      startSearchJob,
      toast,
      workspaceId,
    ],
  );

  const handleCancelProfileSearchJob = useCallback(async () => {
    if (!activeProfileSearchJob) return;
    await cancelSearchJob.mutateAsync({ jobId: activeProfileSearchJob.id });
  }, [activeProfileSearchJob, cancelSearchJob]);

  const handleUseSearchRun = useCallback(
    async (runId: number) => {
      if (isProfileCapturePending) {
        toast.warning(
          "Chờ thu thập nguồn hiện tại hoàn tất trước khi dùng kết quả cũ.",
        );
        return;
      }
      if (selectedRowIndex != null) {
        await flushDecisionsForRows([selectedRowIndex]);
      }
      await setCurrentSearchRun.mutateAsync({ runId });
    },
    [
      flushDecisionsForRows,
      isProfileCapturePending,
      selectedRowIndex,
      setCurrentSearchRun,
      toast,
    ],
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
          const row = reviewRowByIndex.get(rowIndex);
          const itemId = itemIdByRowIndex.get(rowIndex);
          if (!row || itemId == null) return null;
          const decision = catalogDecisionForRow(row);
          if (!decision) return null;
          return { rowIndex, itemId, decision };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);

      if (eligible.length === 0) {
        toast.warning("Không có dòng đã chọn đạt ngưỡng ≥ 85%.");
        return;
      }

      await flushDecisionsForRows(rowIndices);

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

        toast.success(
          `Đã áp dụng ${result.summary.appliedCount.toLocaleString("vi-VN")} dòng (≥ 85%).`,
        );
      } catch {
        // Errors surfaced by mutation onError.
      }
    },
    [
      applyDecisions,
      bulkApplyMatches,
      flushDecisionsForRows,
      itemIdByRowIndex,
      reviewRowByIndex,
      toast,
      workspaceId,
    ],
  );

  const handleBulkApplySearchResults = useCallback(
    async (rowIndices: number[]) => {
      const eligible = rowIndices
        .map((rowIndex) => {
          const row = reviewRowByIndex.get(rowIndex);
          const current = decisionsRef.current.get(rowIndex);
          const itemId = itemIdByRowIndex.get(rowIndex);
          if (!row || !current || itemId == null) return null;
          const applied = searchResultDecisionForRow(row, current);
          if (!applied) return null;
          return { rowIndex, itemId, decision: applied };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);

      if (eligible.length === 0) {
        toast.warning(
          "Không có kết quả đạt ngưỡng tin cậy 75% trên các dòng đã chọn.",
        );
        return;
      }

      for (const entry of eligible) {
        const timer = persistTimers.current.get(entry.rowIndex);
        if (timer) {
          clearTimeout(timer);
          persistTimers.current.delete(entry.rowIndex);
        }
      }
      applyDecisions((prev) => {
        const next = new Map(prev);
        for (const entry of eligible) {
          next.set(entry.rowIndex, entry.decision);
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
        `Đã áp dụng kết quả tìm kiếm cho ${eligible.length.toLocaleString("vi-VN")} dòng.`,
      );
    },
    [
      applyDecisions,
      batchUpdateReviewDecisions,
      itemIdByRowIndex,
      reviewRowByIndex,
      toast,
      workspaceId,
    ],
  );

  const handleUndoBulkApply = useCallback(async () => {
    try {
      const result = await undoLastBulkApply.mutateAsync({ workspaceId });
      toast.success(
        `Đã hoàn tác áp dụng hàng loạt (${result.restoredCount.toLocaleString("vi-VN")} dòng).`,
      );
    } catch {
      // Errors surfaced by mutation onError.
    }
  }, [toast, undoLastBulkApply, workspaceId]);

  const handleContinue = async () => {
    if (isProfileCapturePending) {
      toast.warning("Chờ thu thập nguồn hiện tại hoàn tất trước khi tiếp tục.");
      return;
    }
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
    <div className="space-y-3">
      <section className="panel bg-surface-2 p-4">
        <p className="section-title">Quy trình theo giai đoạn</p>
        <p className="text-ink-1 mt-1 text-sm font-semibold">
          Tìm nguồn web → chọn nguồn → scrape → so sánh → lưu /materials
        </p>
        <p className="text-ink-2 mt-1 text-sm">
          AI là thao tác tùy chọn riêng. Scrape không tự chạy AI và không tự lưu
          vào danh mục vật tư.
        </p>
      </section>

      <ReviewPanel
        workspaceId={workspaceId}
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
        activeProfileSearchJob={
          activeProfileSearchJob as ProfileSearchJobPanelState | null
        }
        activeProfileSearchRuns={
          (activeSearchRunsQuery.data ?? []) as ProfileSearchRunPanelState[]
        }
        latestProfileSearchJob={
          latestProfileSearchJob as ProfileSearchJobPanelState | null
        }
        profileSearchJobPending={
          startSearchJob.isPending || cancelSearchJob.isPending
        }
        profileSearchRuns={
          (searchRunsQuery.data ?? []) as ProfileSearchRunPanelState[]
        }
        profileSearchHistoryLoading={searchRunsQuery.isLoading}
        onProfileSearchJob={handleProfileSearchJob}
        onProfileCancelSearchJob={handleCancelProfileSearchJob}
        onProfileUseSearchRun={handleUseSearchRun}
        onCapturePendingChange={setIsProfileCapturePending}
        emptyTitle="Chưa có kết quả match"
        emptyDescription="Quay lại bước 2, lưu mapping rồi chạy match để tạo danh sách duyệt."
        headerActions={
          <Button
            variant="primary"
            size="sm"
            disabled={
              isFlushing ||
              isProfileCapturePending ||
              batchUpdateReviewDecisions.isPending
            }
            isLoading={isFlushing || batchUpdateReviewDecisions.isPending}
            onClick={() => void handleContinue()}
          >
            Sang xem trước file xuất
          </Button>
        }
      />
    </div>
  );
}
