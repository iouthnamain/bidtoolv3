"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type AiSearchStoredResult,
  type WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  candidateToFields,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { RowDecision } from "~/lib/materials/review-decision";
import { deriveReviewRowStatus } from "~/lib/materials/review-decision";
import {
  countCatalogEligibleRows,
  countSearchResultEligibleRows,
  rowHasSearchResults,
} from "~/lib/materials/profile-review-bulk-apply";
import { runWithConcurrency } from "~/lib/run-with-concurrency";
import { api } from "~/trpc/react";

export type ReviewPanelSummary = {
  totalRows: number;
  auto: number;
  review: number;
  unmatched: number;
};

export type ProfileSearchJobPanelState = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  mode: "web" | "ai";
  requestedItemIds: number[];
  total: number;
  processed: number;
  found: number;
  partial: number;
  failed: number;
  skipped: number;
  currentRowIndex: number | null;
  currentProductName: string | null;
  message: string | null;
  error: string | null;
};

export type ProfileSearchRunPanelState = {
  id: number;
  itemId: number;
  originalRowIndex: number;
  mode: "web" | "ai";
  status:
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "skipped"
    | "cancelled";
  isCurrent: boolean;
  webLinksStatus: "idle" | "pending" | "done" | "error";
  aiSearchStatus: "idle" | "pending" | "done" | "error";
  webLinkResults: WebLinkResult[];
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey: string | null;
  warnings: string[];
  errorMessage: string | null;
  updatedAt: string;
};

function webRowInput(row: ReviewRow) {
  return {
    name: row.name,
    code: row.sheetFields.code,
    manufacturer: row.sheetFields.manufacturer,
    specText: row.sheetFields.specText,
    unit: row.sheetFields.unit,
    category: row.sheetFields.category,
    originCountry: row.sheetFields.originCountry,
  };
}

function profileRunStatusLabel(status: ProfileSearchRunPanelState["status"]) {
  switch (status) {
    case "queued":
      return "Đang chờ";
    case "running":
      return "Đang chạy";
    case "completed":
      return "Hoàn tất";
    case "partial":
      return "Một phần";
    case "failed":
      return "Lỗi";
    case "skipped":
      return "Bỏ qua";
    case "cancelled":
      return "Đã hủy";
  }
}

function profileRunBadgeMeta(run: ProfileSearchRunPanelState): {
  label: string;
  tone: "neutral" | "success" | "warning" | "critical" | "info";
} {
  const prefix = run.mode === "web" ? "Web" : "AI";
  switch (run.status) {
    case "queued":
      return { label: `${prefix} chờ`, tone: "neutral" };
    case "running":
      return { label: `${prefix} đang chạy`, tone: "info" };
    case "completed":
      return { label: `${prefix} xong`, tone: "success" };
    case "partial":
      return { label: `${prefix} một phần`, tone: "warning" };
    case "failed":
      return { label: `${prefix} lỗi`, tone: "critical" };
    case "skipped":
      return { label: "Bỏ qua", tone: "warning" };
    case "cancelled":
      return { label: "Đã hủy", tone: "neutral" };
  }
}

function formatRunTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
  title = "Xét duyệt & chọn sản phẩm",
  subtitleHint,
  emptyTitle = "Không có dòng để đối chiếu",
  emptyDescription = "File không có dòng dữ liệu hợp lệ với cột tên vật tư đã chọn.",
  onDecisionPersist,
  onFlushDecisionsForRows,
  searchMode = "default",
  onProfileBulkApplyCatalog,
  onProfileBulkApplySearchResults,
  onProfileUndoBulkApply,
  profileBulkApplyPending = false,
  profileUndoPending = false,
  profileUndoAvailable = false,
  activeProfileSearchJob = null,
  activeProfileSearchRuns = [],
  latestProfileSearchJob = null,
  profileSearchJobPending = false,
  profileSearchRuns = [],
  profileSearchHistoryLoading = false,
  onProfileSearchJob,
  onProfileCancelSearchJob,
  onProfileUseSearchRun,
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
  /** Optional panel title override (profile auto-fill UX). */
  title?: string;
  /** Optional secondary hint under the title (profile pre-filled state). */
  subtitleHint?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onDecisionPersist?: (rowIndex: number, decision: RowDecision) => void;
  onFlushDecisionsForRows?: (rowIndices: number[]) => void | Promise<void>;
  searchMode?: ReviewSearchMode;
  onProfileBulkApplyCatalog?: (rowIndices: number[]) => void | Promise<void>;
  onProfileBulkApplySearchResults?: (
    rowIndices: number[],
  ) => void | Promise<void>;
  onProfileUndoBulkApply?: () => void | Promise<void>;
  profileBulkApplyPending?: boolean;
  profileUndoPending?: boolean;
  profileUndoAvailable?: boolean;
  activeProfileSearchJob?: ProfileSearchJobPanelState | null;
  activeProfileSearchRuns?: ProfileSearchRunPanelState[];
  latestProfileSearchJob?: ProfileSearchJobPanelState | null;
  profileSearchJobPending?: boolean;
  profileSearchRuns?: ProfileSearchRunPanelState[];
  profileSearchHistoryLoading?: boolean;
  onProfileSearchJob?: (
    kind: "web" | "ai",
    rowIndices: number[],
  ) => void | Promise<void>;
  onProfileCancelSearchJob?: () => void | Promise<void>;
  onProfileUseSearchRun?: (runId: number) => void | Promise<void>;
}) {
  const toast = useToast();
  const isProfileSplit = searchMode === "profileSplit";
  const webSearch = api.material.enrichWebSearchRow.useMutation();
  const webLinksSearch = api.material.enrichWebSearchRowLinks.useMutation();
  const profileSearch = api.material.enrichProfileSearchRow.useMutation();
  const aiSearchSingle = api.material.enrichAiSearchRow.useMutation();
  const selectedRowIndexRef = useRef(selectedRowIndex);
  selectedRowIndexRef.current = selectedRowIndex;
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;

  const [checkedRows, setCheckedRows] = useState<Set<number>>(() => new Set());
  const [bulkProgress, setBulkProgress] = useState<{
    kind: "web" | "ai";
    completed: number;
    total: number;
  } | null>(null);

  const filtered =
    statusFilter === "all"
      ? rows
      : rows.filter(
          (row) =>
            deriveReviewRowStatus(
              decisions.get(row.originalRowIndex),
              row.status,
              row.topCandidate?.materialId ?? null,
            ) === statusFilter,
        );

  const effectiveSummary = useMemo(() => {
    const counts = { auto: 0, review: 0, unmatched: 0 };
    for (const row of rows) {
      const status = deriveReviewRowStatus(
        decisions.get(row.originalRowIndex),
        row.status,
        row.topCandidate?.materialId ?? null,
      );
      counts[status] += 1;
    }
    return { totalRows: rows.length, ...counts };
  }, [rows, decisions]);

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

  const reviewCount = effectiveSummary.review;
  const filters: Array<{
    id: ReviewRowStatus | "all";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "Tất cả", count: rows.length },
    { id: "auto", label: STATUS_META.auto.label, count: effectiveSummary.auto },
    { id: "review", label: STATUS_META.review.label, count: reviewCount },
    {
      id: "unmatched",
      label: STATUS_META.unmatched.label,
      count: effectiveSummary.unmatched,
    },
  ];

  const selectedRow =
    rows.find((row) => row.originalRowIndex === selectedRowIndex) ?? null;
  const decisionStats = useMemo(() => {
    let webPendingCount = 0;
    let aiPendingCount = 0;
    let savedToMaterialsCount = 0;
    for (const decision of decisions.values()) {
      if (
        decision.webSearchStatus === "pending" ||
        decision.webLinksStatus === "pending"
      ) {
        webPendingCount += 1;
      }
      if (decision.aiSearchStatus === "pending") aiPendingCount += 1;
      if (decision.materialId != null) savedToMaterialsCount += 1;
    }
    return { webPendingCount, aiPendingCount, savedToMaterialsCount };
  }, [decisions]);
  const isProfileSearchJobActive =
    activeProfileSearchJob?.status === "queued" ||
    activeProfileSearchJob?.status === "running";
  const activeRunByItemId = useMemo(() => {
    const map = new Map<number, ProfileSearchRunPanelState>();
    for (const run of activeProfileSearchRuns) {
      map.set(run.itemId, run);
    }
    return map;
  }, [activeProfileSearchRuns]);
  const selectedRowActiveProfileRun =
    selectedRow != null
      ? (activeRunByItemId.get(selectedRow.key) ?? null)
      : null;
  const profileSearchJobMode =
    selectedRowActiveProfileRun?.mode ?? activeProfileSearchJob?.mode;
  const profileSearchBusy = profileSearchJobPending || isProfileSearchJobActive;
  const selectedRowProfileSearchPending =
    selectedRowActiveProfileRun?.status === "queued" ||
    selectedRowActiveProfileRun?.status === "running";

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

  const resolveTargetRows = (): ReviewRow[] =>
    rows.filter((row) => checkedRows.has(row.originalRowIndex));

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

  const rowNeedsReview = (row: ReviewRow) => {
    const decision = decisions.get(row.originalRowIndex);
    if (decision?.skipped) return false;
    return !isExportableDecision(
      decision ?? { materialId: null, acceptedFields: new Set() },
    );
  };

  const selectFilteredRows = () => {
    setCheckedRows(new Set(filtered.map((row) => row.originalRowIndex)));
  };

  const selectRowsNeedingReview = () => {
    setCheckedRows(
      new Set(
        filtered.filter(rowNeedsReview).map((row) => row.originalRowIndex),
      ),
    );
  };

  const clearCheckedRows = () => setCheckedRows(new Set());

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
          const targetRow = rows.find((r) => r.originalRowIndex === rowIndex);
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

          const catalog = catalogFieldsForRow(targetRow, current.materialId);
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
          toast.error(error.message || "Không tìm được thông tin trên web.");
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
      aiSearchStatus: "pending" as const,
      webLinkResults: [],
      aiSearchCandidates: [],
      aiSearchResult: undefined,
    };
    updateDecision(rowIndex, nextPending);
    persistDecision(rowIndex, nextPending);

    try {
      const response = isProfileSplit
        ? await profileSearch.mutateAsync(webRowInput(row))
        : await (async () => {
            const linkResponse = await webLinksSearch.mutateAsync(
              webRowInput(row),
            );
            return {
              webLinkResults: linkResponse.results.map((hit) => ({
                title: hit.title,
                url: hit.url,
                domain: hit.domain,
                snippet: hit.snippet,
                query: hit.query,
                rankScore: hit.rankScore,
              })),
              aiSearchCandidates: [] as AiSearchStoredResult[],
              warnings: linkResponse.warnings,
            };
          })();

      const links: WebLinkResult[] = response.webLinkResults;
      const candidates: AiSearchStoredResult[] = response.aiSearchCandidates;
      const webStatus =
        links.length > 0 ? ("done" as const) : ("error" as const);
      const aiStatus =
        candidates.length > 0
          ? ("done" as const)
          : isProfileSplit && links.length > 0
            ? ("error" as const)
            : undefined;

      applyDecisions((prev) => {
        const current = prev.get(rowIndex);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(rowIndex, {
          ...current,
          webLinkResults: links,
          webLinksStatus: webStatus,
          ...(isProfileSplit
            ? {
                aiSearchCandidates: candidates,
                aiSearchResult: candidates[0],
                aiSearchStatus: aiStatus,
              }
            : {}),
        });
        persistDecision(rowIndex, next.get(rowIndex)!);
        return next;
      });

      if (rowIndex === selectedRowIndexRef.current) {
        if (links.length === 0) {
          const warning =
            response.warnings.find((item) => item.trim().length > 0) ??
            "Không tìm thấy liên kết web.";
          toast.warning(warning);
        } else if (isProfileSplit) {
          toast.success(
            candidates.length > 0
              ? `Tìm thấy ${links.length} liên kết và ${candidates.length} ứng viên AI.`
              : `Tìm thấy ${links.length} liên kết web (AI chưa trích xuất được).`,
          );
        } else {
          toast.success(`Tìm thấy ${links.length} liên kết web.`);
        }
      }
    } catch (error) {
      applyDecisions((prev) => {
        const current = prev.get(rowIndex);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(rowIndex, {
          ...current,
          webLinksStatus: "error",
          ...(isProfileSplit ? { aiSearchStatus: "error" as const } : {}),
        });
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
        if (isProfileSplit) {
          const response = await profileSearch.mutateAsync(webRowInput(row));
          links = response.webLinkResults;
          const profileCandidates = response.aiSearchCandidates;
          applyDecisions((prev) => {
            const current = prev.get(rowIndex);
            if (!current) return prev;
            const next = new Map(prev);
            next.set(rowIndex, {
              ...current,
              webLinkResults: links,
              webLinksStatus: links.length > 0 ? "done" : "error",
              aiSearchCandidates: profileCandidates,
              aiSearchResult: profileCandidates[0],
              aiSearchStatus: profileCandidates.length > 0 ? "done" : "error",
            });
            persistDecision(rowIndex, next.get(rowIndex)!);
            return next;
          });
          if (profileCandidates.length > 0) {
            if (rowIndex === selectedRowIndexRef.current) {
              toast.success(
                `Tìm thấy ${profileCandidates.length} ứng viên AI.`,
              );
            }
            return;
          }
        } else {
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
              catalogPdfUrls: result.catalogPdfUrls,
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
      const status =
        candidates.length > 0 ? ("done" as const) : ("error" as const);

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
          error instanceof Error ? error.message : "Trích xuất AI thất bại.",
        );
      }
      throw error;
    }
  };

  const startProfileSearchForRows = async (
    kind: "web" | "ai",
    targets: ReviewRow[],
  ) => {
    if (!onProfileSearchJob) {
      await runWithConcurrency(
        targets.map(
          (row) => () =>
            kind === "web" ? runWebLinksForRow(row) : runAiSearchForRow(row),
        ),
        3,
      );
      return;
    }

    await onFlushDecisionsForRows?.(targets.map((row) => row.originalRowIndex));
    await onProfileSearchJob(
      kind,
      targets.map((row) => row.originalRowIndex),
    );
  };

  const runWebLinksAction = async (row: ReviewRow) => {
    if (isProfileSplit && onProfileSearchJob) {
      await startProfileSearchForRows("web", [row]);
      return;
    }
    await runWebLinksForRow(row);
  };

  const runAiSearchAction = async (row: ReviewRow) => {
    if (isProfileSplit && onProfileSearchJob) {
      await startProfileSearchForRows("ai", [row]);
      return;
    }
    await runAiSearchForRow(row);
  };

  const runBulkSearch = async (kind: "web" | "ai") => {
    if (checkedRows.size === 0) {
      toast.warning("Chọn ít nhất một dòng ở danh sách bên trái.");
      return;
    }

    const targets = resolveTargetRows().filter((row) => row.name.trim());
    if (targets.length === 0) {
      toast.warning("Không có dòng hợp lệ trong các dòng đã chọn.");
      return;
    }

    if (onProfileSearchJob) {
      try {
        await startProfileSearchForRows(kind, targets);
      } catch {
        toast.error(
          kind === "web"
            ? "Không bắt đầu được job tìm nguồn web."
            : "Không bắt đầu được job trích xuất AI.",
        );
      }
      return;
    }

    setBulkProgress({ kind, completed: 0, total: targets.length });

    try {
      await runWithConcurrency(
        targets.map(
          (row) => () =>
            kind === "web" ? runWebLinksForRow(row) : runAiSearchForRow(row),
        ),
        3,
        (completed, total) => setBulkProgress({ kind, completed, total }),
      );
      toast.success(
        kind === "web"
          ? `Đã tìm nguồn web cho ${targets.length} dòng.`
          : `Đã trích xuất AI cho ${targets.length} dòng.`,
      );
    } catch {
      toast.error(
        kind === "web"
          ? "Một số dòng tìm nguồn web thất bại."
          : "Một số dòng trích xuất AI thất bại.",
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
  const selectedRowIndices = Array.from(checkedRows);
  const filteredNeedsReviewCount = filtered.filter(rowNeedsReview).length;
  const selectedCatalogEligibleCount = isProfileSplit
    ? countCatalogEligibleRows(rows, selectedRowIndices)
    : 0;
  const selectedSearchEligibleCount = isProfileSplit
    ? countSearchResultEligibleRows(rows, decisions, selectedRowIndices)
    : 0;
  const selectedHasSearchResults = isProfileSplit
    ? resolveTargetRows().some((row) =>
        rowHasSearchResults(decisions.get(row.originalRowIndex)),
      )
    : false;
  const isBulkRunning = bulkProgress != null || profileSearchBusy;
  const profileSearchProgressPct =
    activeProfileSearchJob && activeProfileSearchJob.total > 0
      ? Math.round(
          (activeProfileSearchJob.processed / activeProfileSearchJob.total) *
            100,
        )
      : 0;
  const terminalProfileSearchJob =
    !activeProfileSearchJob &&
    (latestProfileSearchJob?.status === "failed" ||
      latestProfileSearchJob?.status === "cancelled")
      ? latestProfileSearchJob
      : null;

  if (rows.length === 0) {
    return (
      <section className="panel p-2">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </section>
    );
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-1 border-b border-slate-400 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-balance text-slate-900">
            {title}
          </h3>
          {subtitleHint ? (
            <p className="mt-1 text-xs font-semibold text-emerald-800">
              {subtitleHint}
            </p>
          ) : null}
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
                {decisionStats.webPendingCount.toLocaleString("vi-VN")} đang tìm
                web
              </span>
            ) : (
              <>
                <span className="tabular-nums">
                  {decisionStats.webPendingCount.toLocaleString("vi-VN")} đang
                  tìm liên kết
                </span>
                <span className="tabular-nums">
                  {decisionStats.aiPendingCount.toLocaleString("vi-VN")} đang
                  tìm AI
                </span>
              </>
            )}
            <span className="tabular-nums">
              {decisionStats.savedToMaterialsCount.toLocaleString("vi-VN")} đã
              lưu vật tư
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
                  {bulkProgress.kind === "web"
                    ? "Tìm nguồn web"
                    : "Trích xuất AI"}
                  : {bulkProgress.completed}/{bulkProgress.total}
                </span>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  checkedRows.size === 0 ||
                  bulkTargetCount === 0 ||
                  isBulkRunning
                }
                title={
                  checkedRows.size === 0
                    ? "Chọn dòng trước khi tìm nguồn web"
                    : undefined
                }
                onClick={() => void runBulkSearch("web")}
              >
                <Globe className="h-4 w-4" aria-hidden />
                Tìm nguồn web ({bulkTargetCount.toLocaleString("vi-VN")})
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  checkedRows.size === 0 ||
                  bulkTargetCount === 0 ||
                  isBulkRunning
                }
                title={
                  checkedRows.size === 0
                    ? "Chọn dòng trước khi trích xuất AI"
                    : undefined
                }
                onClick={() => void runBulkSearch("ai")}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Trích xuất AI ({bulkTargetCount.toLocaleString("vi-VN")})
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  checkedRows.size === 0 ||
                  selectedCatalogEligibleCount === 0 ||
                  isBulkRunning ||
                  profileBulkApplyPending
                }
                isLoading={profileBulkApplyPending}
                onClick={() =>
                  void onProfileBulkApplyCatalog?.(selectedRowIndices)
                }
              >
                Áp dụng vật tư ≥ 85% (
                {selectedCatalogEligibleCount.toLocaleString("vi-VN")})
              </Button>
              {selectedHasSearchResults ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={
                    checkedRows.size === 0 ||
                    selectedSearchEligibleCount === 0 ||
                    isBulkRunning ||
                    profileBulkApplyPending
                  }
                  onClick={() =>
                    onProfileBulkApplySearchResults?.(selectedRowIndices)
                  }
                >
                  Áp dụng kết quả tìm kiếm (
                  {selectedSearchEligibleCount.toLocaleString("vi-VN")})
                </Button>
              ) : null}
              {profileUndoAvailable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={profileUndoPending || isBulkRunning}
                  isLoading={profileUndoPending}
                  onClick={() => void onProfileUndoBulkApply?.()}
                >
                  Hoàn tác bulk apply
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={effectiveSummary.auto === 0}
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

      {isProfileSplit ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-400 bg-white px-4 py-2 text-xs text-slate-700">
          <span className="font-semibold tabular-nums">
            Đã chọn {checkedRows.size.toLocaleString("vi-VN")} dòng
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={filtered.length === 0}
            onClick={selectFilteredRows}
          >
            Chọn tất cả trong bộ lọc
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={filteredNeedsReviewCount === 0}
            onClick={selectRowsNeedingReview}
          >
            Chọn dòng cần duyệt (
            {filteredNeedsReviewCount.toLocaleString("vi-VN")})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={checkedRows.size === 0}
            onClick={clearCheckedRows}
          >
            Bỏ chọn
          </Button>
          <span className="text-slate-600">
            AI dùng nguồn web của dòng; nếu chưa có nguồn, hệ thống sẽ tìm nguồn
            trước.
          </span>
        </div>
      ) : null}

      {isProfileSplit && activeProfileSearchJob && isProfileSearchJobActive ? (
        <div className="border-b border-slate-400 bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-900">
                {activeProfileSearchJob.mode === "web"
                  ? "Job tìm web"
                  : "Job tìm AI"}
                : {activeProfileSearchJob.processed}/
                {activeProfileSearchJob.total} dòng
              </p>
              <p className="mt-1 text-xs text-slate-700">
                {activeProfileSearchJob.message ??
                  (isProfileSearchJobActive ? "Đang xử lý." : "Đã kết thúc.")}
                {activeProfileSearchJob.currentProductName
                  ? ` · ${activeProfileSearchJob.currentProductName}`
                  : ""}
              </p>
              <p className="mt-1 text-xs text-slate-700">
                Tìm thấy {activeProfileSearchJob.found} · Một phần{" "}
                {activeProfileSearchJob.partial} · Lỗi{" "}
                {activeProfileSearchJob.failed} · Bỏ qua{" "}
                {activeProfileSearchJob.skipped}
              </p>
            </div>
            {isProfileSearchJobActive && onProfileCancelSearchJob ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onProfileCancelSearchJob()}
              >
                Hủy job
              </Button>
            ) : null}
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={profileSearchProgressPct}
            aria-label="Tiến độ tìm kiếm hồ sơ vật tư"
          >
            <div
              className="bg-brand h-full transition-all"
              style={{ width: `${profileSearchProgressPct}%` }}
            />
          </div>
        </div>
      ) : null}

      {isProfileSplit && terminalProfileSearchJob ? (
        <div className="border-b border-slate-400 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold text-slate-900">
            {terminalProfileSearchJob.mode === "web"
              ? "Job tìm web"
              : "Job tìm AI"}{" "}
            {terminalProfileSearchJob.status === "failed" ? "đã lỗi" : "đã hủy"}
          </p>
          <p className="mt-1 text-xs text-slate-700">
            {terminalProfileSearchJob.error ??
              terminalProfileSearchJob.message ??
              (terminalProfileSearchJob.status === "failed"
                ? "Job tìm kiếm kết thúc với lỗi."
                : "Job tìm kiếm đã được hủy.")}
          </p>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto border-b border-slate-400 lg:max-h-[40rem] lg:border-r lg:border-b-0">
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
            const decision = decisions.get(row.originalRowIndex);
            const rowStatus = deriveReviewRowStatus(
              decision,
              row.status,
              row.topCandidate?.materialId ?? null,
            );
            const meta = STATUS_META[rowStatus];
            const isSelected = row.originalRowIndex === selectedRowIndex;
            const activeProfileRun = activeRunByItemId.get(row.key) ?? null;
            const profileRunBadge = activeProfileRun
              ? profileRunBadgeMeta(activeProfileRun)
              : null;
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
                  aria-pressed={isSelected}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {!isProfileSplit &&
                    decision?.webSearchStatus === "pending" ? (
                      <Badge tone="info">Đang tìm web</Badge>
                    ) : !isProfileSplit &&
                      decision?.webSearchStatus === "error" ? (
                      <Badge tone="critical">Web lỗi</Badge>
                    ) : null}
                    {isProfileSplit && profileRunBadge ? (
                      <Badge tone={profileRunBadge.tone}>
                        {profileRunBadge.label}
                      </Badge>
                    ) : isProfileSplit &&
                      decision?.webLinksStatus === "pending" ? (
                      <Badge tone="info">Web đang chạy</Badge>
                    ) : isProfileSplit &&
                      decision?.webLinksStatus === "error" ? (
                      <Badge tone="critical">Web lỗi</Badge>
                    ) : null}
                    {isProfileSplit &&
                    !profileRunBadge &&
                    decision?.aiSearchStatus === "pending" ? (
                      <Badge tone="info">AI đang chạy</Badge>
                    ) : isProfileSplit &&
                      !profileRunBadge &&
                      decision?.aiSearchStatus === "error" ? (
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
                          : isProfileSplit &&
                              decision?.webLinksStatus === "error"
                            ? " · tìm web thất bại"
                            : isProfileSplit &&
                                decision?.aiSearchStatus === "error"
                              ? " · tìm AI thất bại"
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
            <>
              <MatchChooser
                key={selectedRow.originalRowIndex}
                row={selectedRow}
                decision={decisions.get(selectedRow.originalRowIndex)}
                onChange={(next) =>
                  handleDecisionChange(selectedRow.originalRowIndex, next)
                }
                searchMode={searchMode}
                onWebSearch={() => handleWebSearch(selectedRow)}
                onWebLinksSearch={() => void runWebLinksAction(selectedRow)}
                onAiSearch={() => void runAiSearchAction(selectedRow)}
                isWebLinksPending={
                  isProfileSplit
                    ? selectedRowProfileSearchPending &&
                      profileSearchJobMode === "web"
                    : decisions.get(selectedRow.originalRowIndex)
                        ?.webLinksStatus === "pending"
                }
                isAiSearchPending={
                  isProfileSplit
                    ? selectedRowProfileSearchPending &&
                      profileSearchJobMode === "ai"
                    : decisions.get(selectedRow.originalRowIndex)
                        ?.aiSearchStatus === "pending"
                }
                isWebSearchPending={
                  decisions.get(selectedRow.originalRowIndex)
                    ?.webSearchStatus === "pending"
                }
              />

              {isProfileSplit ? (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-900">
                      Lịch sử tìm kiếm
                    </h4>
                    {profileSearchHistoryLoading ? (
                      <span className="text-xs text-slate-600">Đang tải…</span>
                    ) : null}
                  </div>
                  {profileSearchRuns.length > 0 ? (
                    <div className="mt-2 divide-y divide-slate-100">
                      {profileSearchRuns.slice(0, 10).map((run) => {
                        const canReuse =
                          !run.isCurrent &&
                          run.status !== "queued" &&
                          run.status !== "running" &&
                          run.status !== "cancelled";
                        return (
                          <div
                            key={run.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900">
                                {run.mode === "web" ? "Web" : "AI"} ·{" "}
                                {profileRunStatusLabel(run.status)}
                                {run.isCurrent ? " · đang dùng" : ""}
                              </p>
                              <p className="mt-0.5 text-slate-600">
                                {formatRunTime(run.updatedAt)} ·{" "}
                                {run.webLinkResults.length} link ·{" "}
                                {run.aiSearchCandidates.length} ứng viên
                                {run.errorMessage
                                  ? ` · ${run.errorMessage}`
                                  : run.warnings[0]
                                    ? ` · ${run.warnings[0]}`
                                    : ""}
                              </p>
                            </div>
                            {canReuse && onProfileUseSearchRun ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  void onProfileUseSearchRun(run.id)
                                }
                              >
                                Dùng lại
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-600">
                      Chưa có lịch sử tìm kiếm cho dòng này.
                    </p>
                  )}
                </div>
              ) : null}
            </>
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
