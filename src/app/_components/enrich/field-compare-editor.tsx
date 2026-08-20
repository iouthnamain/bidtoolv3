"use client";

import { useEffect, useId, useMemo, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";

import { Button } from "~/app/_components/ui";
import {
  ProductCandidateCard,
  type EnrichCandidate,
} from "~/app/_components/enrich/product-candidate-card";
import {
  SearchSourceCandidateCard,
  type SearchSourceCandidate,
} from "~/app/_components/materials/review/search-source-candidate-card";
import { mergeWebGapFill } from "~/lib/materials/enrich-gap-fill";
import {
  buildFillPlanWithEdits,
  candidateToFields,
  FIELD_LABELS,
  FILLABLE_FIELDS,
  isPriceField,
  NON_COLUMN_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import { formatMoney, parseOptionalNumber } from "~/lib/materials/format";
import {
  catalogCandidateScore,
  sortCandidatesByScore,
} from "~/lib/materials/search-candidate-match";
import type { ProfileExtraField } from "~/lib/materials/profile-scrape-types";

/**
 * Shared side-by-side compare + per-field edit panel. Extracted from the step-2
 * `MatchChooser` so the Excel-research review (step 3) and the material-enrich
 * dialog can present the same UX: sheet/current values on the left, the
 * proposed/found values per field, optional accept checkboxes, a "Ghi đè"
 * overwrite toggle for populated cells, and inline editing of proposed values.
 *
 * It is purely presentational — it fetches nothing. The host owns the decision
 * state (`accepted`/`overwrite`/`editedValues`), the catalog search query, and
 * the candidate list, passing them in and receiving granular callbacks. Feature
 * flags switch the optional affordances on per surface.
 */
export type FieldCompareEditorProps = {
  /** Title shown above the current-values pills (e.g. "Dòng Excel 12"). */
  sheetLabel: string;
  /** Secondary line under the title (product/material name). */
  sheetName: string;
  /** The current/left-hand values keyed by fillable field. */
  sheetFields: Partial<Record<FillableField, string>>;
  /**
   * Proposed/found values used for the fill plan when NO catalog candidate is
   * selected (web-research found-fields, material extraction result). When a
   * candidate IS chosen, its fields take precedence as the base.
   */
  proposedFields?: Partial<Record<FillableField, string>>;

  /** Decision state (lifted to the host). */
  selectedMaterialId: number | null;
  accepted: Set<FillableField>;
  overwrite: Set<FillableField>;
  editedValues: Partial<Record<FillableField, string>>;

  /** Per-field callbacks. */
  onToggleField: (field: FillableField) => void;
  onToggleOverwrite: (field: FillableField) => void;
  onEditValue: (field: FillableField, value: string) => void;
  /** Clears the current match/decision (the "Bỏ ghép dòng này" action). */
  onClear: () => void;

  /** Candidate grid + manual catalog search (step-2 / step-3 re-pick). */
  enableCandidateGrid?: boolean;
  candidates?: EnrichCandidate[];
  recommendedMaterialId?: number | null;
  searchTerm?: string;
  onSearchTermChange?: (value: string) => void;
  isSearching?: boolean;
  showingSearch?: boolean;
  onChoose?: (candidate: EnrichCandidate) => void;

  /** Inline edit of the proposed value (off for step-2 by default). */
  enableInlineEdit?: boolean;
  /** Show force-overwrite controls for fields that already have values. */
  enableOverwrite?: boolean;

  /** Per-row skip toggle (step-2 / step-3). */
  enableSkip?: boolean;
  isSkipped?: boolean;
  onToggleSkip?: () => void;
  skipLabel?: string;
  skippedLabel?: string;

  /** Override the clear-button label per surface. */
  clearLabel?: string;

  /**
   * Force the per-field decision panel even when no catalog candidate is chosen
   * (step-2 manual/web-only rows).
   */
  forceShowDecision?: boolean;

  /** Side-by-side before/after columns instead of inline arrows. */
  compareLayout?: "inline" | "sideBySide";
  /** Label for the proposed-value column in side-by-side mode. */
  afterColumnLabel?: string;
  /** Profile review: every field is editable and included without checkboxes. */
  alwaysEditableFields?: boolean;
  /** Catalog PDF URLs extracted from web/AI search. */
  catalogPdfUrls?: string[];
  catalogPdfUrlsBefore?: string[];
  catalogPdfProvenance?: string;
  catalogPdfAccepted?: boolean;
  onToggleCatalogPdfUrls?: () => void;
  onEditCatalogPdfUrls?: (raw: string) => void;
  profileExtraFields?: {
    before: Record<ProfileExtraField, string>;
    after: Record<ProfileExtraField, string>;
    accepted: Set<ProfileExtraField>;
    provenance?: Partial<Record<ProfileExtraField, string>>;
  };
  onToggleProfileField?: (field: ProfileExtraField) => void;
  onEditProfileValue?: (field: ProfileExtraField, value: string) => void;
  fieldProvenance?: Partial<Record<FillableField, string>>;

  /** Web/AI search results shown as additional selectable candidate cards. */
  searchSourceCandidates?: SearchSourceCandidate[];
  selectedSearchCandidateKey?: string | null;
  onChooseSearchCandidate?: (key: string) => void;
  onCaptureSearchCandidate?: (key: string) => void;
  onRejectSearchCandidate?: (key: string) => void;
  rejectingSearchCandidateKey?: string | null;
  rejectSearchCandidateDisabled?: boolean;
  capturingSearchCandidateKey?: string | null;
  captureSearchCandidateDisabled?: boolean;
  captureSearchCandidateStatus?: string;
  selectedSourceInlineLayer?: ReactNode;
  getCaptureSearchCandidateState?: (key: string) => {
    pending?: boolean;
    disabled?: boolean;
    actionLabel?: string;
    statusText?: string;
    inlineLayer?: ReactNode;
  };
  /** Actions that belong to the comparison-ledger header. */
  decisionActions?: ReactNode;
  /** Profile: merge catalog + web/AI cards, sorted by score. */
  unifiedCandidateGrid?: boolean;
  /**
   * Profile review can keep candidates and the resulting fill plan in peer
   * panes. Other surfaces keep the existing stacked layout by default.
   */
  decisionPaneLayout?: "stacked" | "sideBySide";
};

const EDITABLE_FIELDS = FILLABLE_FIELDS.filter(
  (field) => !NON_COLUMN_FIELDS.has(field),
);

function parsePriceInput(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
  return parseOptionalNumber(normalized);
}

function formatCompareFieldValue(
  field: FillableField,
  value: string,
  currency?: string,
) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (field === "defaultUnitPrice") {
    const parsed = parsePriceInput(trimmed);
    if (parsed != null) {
      return formatMoney(parsed, currency?.trim() ?? "VND");
    }
  }
  return trimmed;
}

function beforeFieldClass(field: FillableField) {
  return isPriceField(field)
    ? "text-amber-900/80 font-medium tabular-nums"
    : "text-slate-700";
}

function afterFieldTextClass(field: FillableField) {
  return isPriceField(field)
    ? "font-semibold text-amber-800 tabular-nums"
    : "font-medium text-emerald-700";
}

function afterFieldInputClass(field: FillableField) {
  return isPriceField(field)
    ? "w-full min-w-0 max-w-full rounded border border-amber-400 bg-amber-50/60 px-1.5 py-0.5 text-xs font-semibold text-amber-900 tabular-nums shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
    : "w-full min-w-0 max-w-full rounded border border-slate-500 bg-white px-1.5 py-0.5 text-xs font-medium text-emerald-700 shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none";
}

const MULTILINE_FIELDS = new Set<FillableField>(["specText"]);

function isMultilineField(field: FillableField) {
  return MULTILINE_FIELDS.has(field);
}

function multilineFieldRows(value: string) {
  const lineCount = value.split("\n").filter((line) => line.trim()).length;
  return Math.min(12, Math.max(3, lineCount + 1));
}

function renderAfterFieldInput(
  field: FillableField,
  value: string,
  onChange: (value: string) => void,
  ariaLabel: string,
) {
  const className = afterFieldInputClass(field);
  if (isMultilineField(field)) {
    return (
      <textarea
        value={value}
        rows={multilineFieldRows(value)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className={`${className} min-h-20 resize-y whitespace-pre-wrap`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={`min-w-0 flex-1 ${className}`}
    />
  );
}

export function FieldCompareEditor({
  sheetLabel,
  sheetName,
  sheetFields,
  proposedFields,
  selectedMaterialId,
  accepted,
  overwrite,
  editedValues,
  onToggleField,
  onToggleOverwrite,
  onEditValue,
  onClear,
  enableCandidateGrid = false,
  candidates = [],
  recommendedMaterialId = null,
  searchTerm = "",
  onSearchTermChange,
  isSearching = false,
  showingSearch = false,
  onChoose,
  enableInlineEdit = false,
  enableOverwrite = true,
  enableSkip = false,
  isSkipped = false,
  onToggleSkip,
  skipLabel = "Bỏ qua dòng này",
  skippedLabel = "Bỏ qua: bật",
  clearLabel = "Bỏ ghép dòng này",
  forceShowDecision = false,
  compareLayout = "inline",
  afterColumnLabel = "Sau",
  alwaysEditableFields = false,
  catalogPdfUrls,
  catalogPdfUrlsBefore,
  catalogPdfProvenance,
  catalogPdfAccepted,
  onToggleCatalogPdfUrls,
  onEditCatalogPdfUrls,
  profileExtraFields,
  onToggleProfileField,
  onEditProfileValue,
  fieldProvenance,
  searchSourceCandidates = [],
  selectedSearchCandidateKey = null,
  onChooseSearchCandidate,
  onCaptureSearchCandidate,
  onRejectSearchCandidate,
  rejectingSearchCandidateKey = null,
  rejectSearchCandidateDisabled = false,
  capturingSearchCandidateKey = null,
  captureSearchCandidateDisabled = false,
  captureSearchCandidateStatus,
  selectedSourceInlineLayer,
  getCaptureSearchCandidateState,
  decisionActions,
  unifiedCandidateGrid = false,
  decisionPaneLayout = "stacked",
}: FieldCompareEditorProps) {
  const candidatePaneHeadingId = useId();
  const fillPlanHeadingId = useId();

  // The base material fields feeding the plan: a chosen catalog candidate wins,
  // otherwise the surface's proposed/found values.
  const selectedCandidate =
    enableCandidateGrid && selectedMaterialId != null
      ? (candidates.find((c) => c.materialId === selectedMaterialId) ?? null)
      : null;

  const catalogFields = selectedCandidate
    ? candidateToFields(selectedCandidate)
    : null;
  const baseFields: Partial<Record<FillableField, string>> =
    catalogFields != null
      ? mergeWebGapFill(sheetFields, catalogFields, proposedFields ?? {})
      : (proposedFields ?? {});

  // Plan reflects edits overlaid on the base, honoring force-overwrite.
  const plan = buildFillPlanWithEdits(
    sheetFields,
    baseFields,
    editedValues,
    overwrite,
  );

  // A decision panel is worth showing when a candidate is chosen, when the
  // surface supplied proposed/found values to act on, or when the user has
  // typed an inline edit. (Step-2 has no proposedFields, so it only appears
  // after a candidate pick; step-3/material show their found values upfront.)
  const hasProposed = Object.values(baseFields).some(
    (v) => (v ?? "").trim().length > 0,
  );
  const hasDecision =
    forceShowDecision ||
    selectedMaterialId != null ||
    selectedSearchCandidateKey != null ||
    hasProposed ||
    Object.values(editedValues).some((v) => (v ?? "").trim().length > 0);

  type UnifiedGridEntry =
    | {
        kind: "catalog";
        candidate: EnrichCandidate;
        score: number;
        status?: undefined;
        fillCount: number;
        key: string;
      }
    | {
        kind: "search";
        candidate: SearchSourceCandidate;
        score: number;
        status?: SearchSourceCandidate["status"];
        key: string;
      };

  const unifiedGridEntries = useMemo((): UnifiedGridEntry[] => {
    if (!unifiedCandidateGrid) return [];

    const entries: UnifiedGridEntry[] = [];
    for (const candidate of candidates) {
      entries.push({
        kind: "catalog",
        candidate,
        score: catalogCandidateScore(candidate.score),
        fillCount: buildFillPlanWithEdits(
          sheetFields,
          candidateToFields(candidate),
          {},
          new Set(),
        ).filter((cell) => cell.action === "filled").length,
        key: `catalog:${candidate.materialId}`,
      });
    }
    for (const candidate of searchSourceCandidates) {
      if (candidate.tier === "weak") continue;
      entries.push({
        kind: "search",
        candidate,
        score: candidate.score,
        status: candidate.status,
        key: candidate.key,
      });
    }

    return sortCandidatesByScore(entries);
  }, [candidates, searchSourceCandidates, sheetFields, unifiedCandidateGrid]);

  const catalogCardCount = candidates.length;
  const searchCardCount = searchSourceCandidates.length;
  const totalHotkeyCards = unifiedCandidateGrid
    ? unifiedGridEntries.length
    : catalogCardCount + searchCardCount;

  // Digit keys 1-9 select catalog or search-source candidate cards.
  useEffect(() => {
    if (!enableCandidateGrid) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      const digit = Number(event.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;

      if (unifiedCandidateGrid) {
        const entry = unifiedGridEntries[digit - 1];
        if (!entry) return;
        if (entry.kind === "catalog") {
          if (!onChoose) return;
          event.preventDefault();
          onChoose(entry.candidate);
          return;
        }
        if (
          entry.candidate.status === "pending" ||
          entry.candidate.status === "error" ||
          !onChooseSearchCandidate
        ) {
          return;
        }
        event.preventDefault();
        onChooseSearchCandidate(entry.candidate.key);
        return;
      }

      if (digit <= catalogCardCount && onChoose) {
        const candidate = candidates[digit - 1];
        if (!candidate) return;
        event.preventDefault();
        onChoose(candidate);
        return;
      }
      const searchIndex = digit - catalogCardCount - 1;
      const searchCandidate = searchSourceCandidates[searchIndex];
      if (!searchCandidate || !onChooseSearchCandidate) return;
      if (
        searchCandidate.status === "pending" ||
        searchCandidate.status === "error"
      ) {
        return;
      }
      event.preventDefault();
      onChooseSearchCandidate(searchCandidate.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    candidates,
    searchSourceCandidates,
    enableCandidateGrid,
    catalogCardCount,
    unifiedCandidateGrid,
    unifiedGridEntries,
  ]);

  const selectedSearchCandidate =
    selectedSearchCandidateKey != null
      ? (searchSourceCandidates.find(
          (candidate) => candidate.key === selectedSearchCandidateKey,
        ) ?? null)
      : null;

  const shouldSplitDecisionPane = decisionPaneLayout === "sideBySide";
  const candidatePane = enableCandidateGrid ? (
    <div className="max-w-full min-w-0 space-y-4">
      {onSearchTermChange ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-600"
            aria-hidden
          />
          <input
            type="search"
            name="catalogSearch"
            autoComplete="off"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Tìm vật tư trong danh mục…"
            spellCheck={false}
            aria-label="Tìm sản phẩm khác trong catalog"
            className="w-full max-w-full min-w-0 rounded border border-slate-400 py-2 pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          />
        </div>
      ) : null}

      {showingSearch && isSearching ? (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-xs text-slate-700"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Đang tìm…
        </p>
      ) : candidates.length === 0 && searchSourceCandidates.length === 0 ? (
        <p className="rounded border border-dashed border-slate-400 bg-slate-50 px-3 py-6 text-center text-xs text-slate-700">
          {showingSearch
            ? "Không tìm thấy sản phẩm phù hợp."
            : "Không có ứng viên ghép tự động — hãy tìm nguồn phù hợp hoặc thêm URL thủ công."}
        </p>
      ) : (
        <div className="space-y-2">
          {totalHotkeyCards > 0 ? (
            <p className="text-xs font-semibold text-slate-700">
              Mẹo: bấm phím 1-{Math.min(9, totalHotkeyCards)} để chọn nhanh ứng
              viên tương ứng.
            </p>
          ) : null}
          <div
            className={
              shouldSplitDecisionPane
                ? "profile-candidate-grid"
                : "grid max-w-full min-w-0 gap-1 sm:grid-cols-2 xl:grid-cols-3"
            }
          >
            {unifiedCandidateGrid ? (
              unifiedGridEntries
                .filter(
                  (entry) =>
                    entry.kind === "catalog" || entry.candidate.tier !== "weak",
                )
                .map((entry, index) => {
                  const isTopReady =
                    index === 0 &&
                    (entry.kind === "catalog" ||
                      (entry.kind === "search" &&
                        entry.candidate.status !== "pending" &&
                        entry.candidate.status !== "error"));
                  if (entry.kind === "catalog") {
                    return (
                      <ProductCandidateCard
                        key={entry.key}
                        candidate={entry.candidate}
                        isSelected={
                          selectedSearchCandidateKey == null &&
                          entry.candidate.materialId === selectedMaterialId
                        }
                        isRecommended={!showingSearch && isTopReady}
                        fillCount={entry.fillCount}
                        onChoose={() => onChoose?.(entry.candidate)}
                      />
                    );
                  }
                  return (
                    <SearchSourceCandidateCard
                      key={entry.key}
                      candidate={{
                        ...entry.candidate,
                        isRecommended: isTopReady,
                      }}
                      isSelected={
                        selectedSearchCandidateKey === entry.candidate.key
                      }
                      onChoose={() =>
                        onChooseSearchCandidate?.(entry.candidate.key)
                      }
                      onCapture={
                        onCaptureSearchCandidate
                          ? () => onCaptureSearchCandidate(entry.candidate.key)
                          : undefined
                      }
                      onReject={
                        onRejectSearchCandidate
                          ? () => onRejectSearchCandidate(entry.candidate.key)
                          : undefined
                      }
                      isRejectPending={
                        rejectingSearchCandidateKey === entry.candidate.key
                      }
                      isRejectDisabled={rejectSearchCandidateDisabled}
                      isCapturePending={
                        getCaptureSearchCandidateState?.(entry.candidate.key)
                          .pending ??
                        capturingSearchCandidateKey === entry.candidate.key
                      }
                      isCaptureDisabled={
                        getCaptureSearchCandidateState?.(entry.candidate.key)
                          .disabled ??
                        (captureSearchCandidateDisabled ||
                          capturingSearchCandidateKey != null)
                      }
                      captureStatusText={
                        getCaptureSearchCandidateState?.(entry.candidate.key)
                          .statusText ??
                        (capturingSearchCandidateKey === entry.candidate.key
                          ? captureSearchCandidateStatus
                          : undefined)
                      }
                      captureActionLabel={
                        getCaptureSearchCandidateState?.(entry.candidate.key)
                          .actionLabel
                      }
                      inlineLayer={
                        getCaptureSearchCandidateState?.(entry.candidate.key)
                          .inlineLayer ??
                        (selectedSearchCandidateKey === entry.candidate.key
                          ? selectedSourceInlineLayer
                          : undefined)
                      }
                      hotkeyIndex={index + 1}
                    />
                  );
                })
            ) : (
              <>
                {candidates.map((candidate, index) => (
                  <ProductCandidateCard
                    key={candidate.materialId}
                    candidate={candidate}
                    isSelected={
                      selectedSearchCandidateKey == null &&
                      candidate.materialId === selectedMaterialId
                    }
                    isRecommended={
                      !showingSearch &&
                      index === 0 &&
                      recommendedMaterialId === candidate.materialId
                    }
                    fillCount={
                      buildFillPlanWithEdits(
                        sheetFields,
                        candidateToFields(candidate),
                        {},
                        new Set(),
                      ).filter((cell) => cell.action === "filled").length
                    }
                    onChoose={() => onChoose?.(candidate)}
                    hotkeyIndex={index + 1}
                  />
                ))}
                {searchSourceCandidates.map((candidate, index) => (
                  <SearchSourceCandidateCard
                    key={candidate.key}
                    candidate={candidate}
                    isSelected={selectedSearchCandidateKey === candidate.key}
                    onChoose={() => onChooseSearchCandidate?.(candidate.key)}
                    onCapture={
                      onCaptureSearchCandidate
                        ? () => onCaptureSearchCandidate(candidate.key)
                        : undefined
                    }
                    onReject={
                      onRejectSearchCandidate
                        ? () => onRejectSearchCandidate(candidate.key)
                        : undefined
                    }
                    isRejectPending={
                      rejectingSearchCandidateKey === candidate.key
                    }
                    isRejectDisabled={rejectSearchCandidateDisabled}
                    isCapturePending={
                      getCaptureSearchCandidateState?.(candidate.key).pending ??
                      capturingSearchCandidateKey === candidate.key
                    }
                    isCaptureDisabled={
                      getCaptureSearchCandidateState?.(candidate.key)
                        .disabled ??
                      (captureSearchCandidateDisabled ||
                        capturingSearchCandidateKey != null)
                    }
                    captureStatusText={
                      getCaptureSearchCandidateState?.(candidate.key)
                        .statusText ??
                      (capturingSearchCandidateKey === candidate.key
                        ? captureSearchCandidateStatus
                        : undefined)
                    }
                    captureActionLabel={
                      getCaptureSearchCandidateState?.(candidate.key)
                        .actionLabel
                    }
                    inlineLayer={
                      getCaptureSearchCandidateState?.(candidate.key)
                        .inlineLayer ??
                      (selectedSearchCandidateKey === candidate.key
                        ? selectedSourceInlineLayer
                        : undefined)
                    }
                    hotkeyIndex={catalogCardCount + index + 1}
                  />
                ))}
              </>
            )}
          </div>
          {unifiedCandidateGrid &&
          searchSourceCandidates.some(
            (candidate) => candidate.tier === "weak",
          ) ? (
            <section className="rounded border border-amber-300 bg-amber-50/50 p-2">
              <h4 className="flex min-h-10 items-center font-semibold text-amber-900">
                Kết quả cần kiểm tra (
                {
                  searchSourceCandidates.filter(
                    (candidate) => candidate.tier === "weak",
                  ).length
                }
                )
              </h4>
              <p className="mt-1 text-xs text-amber-900">
                Các nguồn này chỉ để kiểm tra thủ công và không được đề xuất tự
                động.
              </p>
              <div className="profile-candidate-grid mt-2">
                {searchSourceCandidates
                  .filter((candidate) => candidate.tier === "weak")
                  .map((candidate) => (
                    <SearchSourceCandidateCard
                      key={candidate.key}
                      candidate={candidate}
                      isSelected={selectedSearchCandidateKey === candidate.key}
                      onChoose={() => onChooseSearchCandidate?.(candidate.key)}
                      onCapture={
                        onCaptureSearchCandidate
                          ? () => onCaptureSearchCandidate(candidate.key)
                          : undefined
                      }
                      onReject={
                        onRejectSearchCandidate
                          ? () => onRejectSearchCandidate(candidate.key)
                          : undefined
                      }
                      isRejectPending={
                        rejectingSearchCandidateKey === candidate.key
                      }
                      isRejectDisabled={rejectSearchCandidateDisabled}
                      isCapturePending={
                        getCaptureSearchCandidateState?.(candidate.key)
                          .pending ??
                        capturingSearchCandidateKey === candidate.key
                      }
                      isCaptureDisabled={
                        getCaptureSearchCandidateState?.(candidate.key)
                          .disabled ??
                        (captureSearchCandidateDisabled ||
                          capturingSearchCandidateKey != null)
                      }
                      captureActionLabel={
                        getCaptureSearchCandidateState?.(candidate.key)
                          .actionLabel
                      }
                      captureStatusText={
                        getCaptureSearchCandidateState?.(candidate.key)
                          .statusText
                      }
                      inlineLayer={
                        getCaptureSearchCandidateState?.(candidate.key)
                          .inlineLayer
                      }
                    />
                  ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  ) : null;

  const fillPlanPane =
    hasDecision || shouldSplitDecisionPane ? (
      <section
        aria-labelledby={fillPlanHeadingId}
        className={`max-w-full min-w-0 rounded bg-white p-3 ${
          shouldSplitDecisionPane
            ? "profile-decision-ledger"
            : "border-line border shadow-[var(--shadow-flat)]"
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h3
            id={fillPlanHeadingId}
            className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase"
          >
            Sẽ điền vào dòng
          </h3>
          {decisionActions ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {decisionActions}
            </div>
          ) : null}
        </div>
        {hasDecision ? (
          <>
            {compareLayout === "sideBySide" ? (
              <div className="mt-2 max-w-full min-w-0">
                <table
                  aria-labelledby={fillPlanHeadingId}
                  className="profile-decision-table w-full table-fixed border-collapse text-xs"
                >
                  <caption className="sr-only">
                    Các giá trị dự kiến điền vào dòng hiện tại
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-300 text-left text-slate-600">
                      {!alwaysEditableFields ? (
                        <th
                          scope="col"
                          className="profile-decision-check-column py-2 pr-2"
                        >
                          <span className="sr-only">Chọn trường</span>
                        </th>
                      ) : null}
                      <th
                        scope="col"
                        className="profile-decision-field-column py-2 pr-2 font-semibold"
                      >
                        Trường
                      </th>
                      <th
                        scope="col"
                        className="profile-decision-before-column py-2 pr-2 font-semibold"
                      >
                        Trước
                      </th>
                      <th
                        scope="col"
                        className="profile-decision-after-column py-2 font-semibold"
                      >
                        {afterColumnLabel}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileExtraFields
                      ? (["name", "imageUrl"] as const).map((field) => {
                          const label =
                            field === "name" ? "Tên vật tư" : "Ảnh sản phẩm";
                          const beforeValue = profileExtraFields.before[field];
                          const afterValue = profileExtraFields.after[field];
                          return (
                            <tr
                              key={field}
                              className="border-b border-slate-100 bg-slate-50/80"
                            >
                              {!alwaysEditableFields ? (
                                <td className="py-2 pr-2 align-top">
                                  <label className="inline-flex size-6 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-blue-500">
                                    <input
                                      type="checkbox"
                                      className="size-4"
                                      checked={profileExtraFields.accepted.has(
                                        field,
                                      )}
                                      onChange={() =>
                                        onToggleProfileField?.(field)
                                      }
                                      aria-label={`Chấp nhận ${label}`}
                                    />
                                  </label>
                                </td>
                              ) : null}
                              <th
                                scope="row"
                                className="min-w-0 py-2 pr-2 text-left align-top font-semibold break-words text-slate-600"
                              >
                                {label}
                                {profileExtraFields.provenance?.[field] ? (
                                  <span className="border-line bg-surface-2 text-ink-3 mt-1 block w-fit rounded border px-1 py-0.5 text-[10px] font-semibold">
                                    {profileExtraFields.provenance[field]}
                                  </span>
                                ) : null}
                              </th>
                              <td className="min-w-0 py-2 pr-2 align-top break-words text-slate-700">
                                {field === "imageUrl" && beforeValue ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary external evidence URL.
                                  <img
                                    src={beforeValue}
                                    alt="Ảnh vật tư trước thay đổi"
                                    width={64}
                                    height={48}
                                    className="border-line h-12 w-16 rounded border object-cover"
                                  />
                                ) : (
                                  beforeValue || "(trống)"
                                )}
                              </td>
                              <td className="min-w-0 py-2 pr-2 align-top break-words">
                                <input
                                  value={afterValue}
                                  onChange={(event) =>
                                    onEditProfileValue?.(
                                      field,
                                      event.target.value,
                                    )
                                  }
                                  aria-label={`${afterColumnLabel} ${label}`}
                                  className="border-line bg-surface-1 text-good focus-visible:ring-ring min-h-9 w-full rounded border px-1.5 py-0.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                                />
                                {field === "imageUrl" && afterValue ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary external evidence URL.
                                  <img
                                    src={afterValue}
                                    alt="Ảnh vật tư sau thay đổi"
                                    width={64}
                                    height={48}
                                    className="border-line mt-1 h-12 w-16 rounded border object-cover"
                                  />
                                ) : null}
                              </td>
                            </tr>
                          );
                        })
                      : null}
                    {(alwaysEditableFields
                      ? FILLABLE_FIELDS
                      : plan.map((cell) => cell.field)
                    ).map((field) => {
                      const cell = plan.find((item) => item.field === field);
                      const isFillable = alwaysEditableFields
                        ? true
                        : cell?.action === "filled" ||
                          cell?.action === "overwritten";
                      const beforeValue =
                        sheetFields[field]?.trim() ?? cell?.before ?? "";
                      const afterValue =
                        editedValues[field] ??
                        (alwaysEditableFields
                          ? (baseFields[field] ?? "")
                          : (cell?.after ?? ""));
                      const currency =
                        editedValues.currency ??
                        sheetFields.currency ??
                        baseFields.currency;
                      const beforeDisplay =
                        beforeValue.trim().length > 0
                          ? formatCompareFieldValue(
                              field,
                              beforeValue,
                              currency,
                            ) || beforeValue
                          : "(trống)";
                      const afterDisplay =
                        afterValue.trim().length > 0
                          ? formatCompareFieldValue(
                              field,
                              afterValue,
                              currency,
                            ) || afterValue
                          : "";
                      return (
                        <tr
                          key={field}
                          className={`border-b border-slate-100 ${
                            isFillable ? "bg-slate-50/80" : "opacity-60"
                          }`}
                        >
                          {!alwaysEditableFields ? (
                            <td className="py-2 pr-2 align-top">
                              <label className="inline-flex size-6 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-blue-500 has-[:disabled]:cursor-not-allowed">
                                <input
                                  type="checkbox"
                                  className="size-4"
                                  disabled={!isFillable}
                                  checked={isFillable && accepted.has(field)}
                                  onChange={() => onToggleField(field)}
                                  aria-label={`Chấp nhận ${FIELD_LABELS[field]}`}
                                />
                              </label>
                            </td>
                          ) : null}
                          <th
                            scope="row"
                            className="min-w-0 py-2 pr-2 text-left align-top font-semibold break-words text-slate-600"
                          >
                            {FIELD_LABELS[field]}
                            {fieldProvenance?.[field] ? (
                              <span className="border-line bg-surface-2 text-ink-3 mt-1 block w-fit rounded border px-1 py-0.5 text-[10px] font-semibold">
                                {fieldProvenance[field]}
                              </span>
                            ) : null}
                          </th>
                          <td
                            className={`min-w-0 py-2 pr-2 align-top break-words ${beforeFieldClass(field)} ${
                              isMultilineField(field)
                                ? "whitespace-pre-wrap"
                                : ""
                            }`}
                          >
                            {beforeDisplay}
                          </td>
                          <td className="min-w-0 py-2 pr-2 align-top break-words">
                            {isFillable ? (
                              enableInlineEdit ? (
                                renderAfterFieldInput(
                                  field,
                                  afterValue,
                                  (next) => onEditValue(field, next),
                                  `${afterColumnLabel} ${FIELD_LABELS[field]}`,
                                )
                              ) : (
                                <span className={afterFieldTextClass(field)}>
                                  {afterDisplay}
                                </span>
                              )
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {onEditCatalogPdfUrls ? (
                      <tr className="border-b border-slate-100 bg-slate-50/80">
                        {!alwaysEditableFields ? (
                          <td className="py-2 pr-2 align-top">
                            <label className="inline-flex size-6 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-blue-500">
                              <input
                                type="checkbox"
                                className="size-4"
                                checked={
                                  catalogPdfAccepted ??
                                  (catalogPdfUrls?.length ?? 0) > 0
                                }
                                onChange={onToggleCatalogPdfUrls}
                                readOnly={!onToggleCatalogPdfUrls}
                                aria-label="Chấp nhận URL catalog"
                              />
                            </label>
                          </td>
                        ) : null}
                        <th
                          scope="row"
                          className="min-w-0 py-2 pr-2 text-left align-top font-semibold break-words text-slate-600"
                        >
                          URL catalog
                          {catalogPdfProvenance ? (
                            <span className="border-line bg-surface-2 text-ink-3 mt-1 block w-fit rounded border px-1 py-0.5 text-[10px] font-semibold">
                              {catalogPdfProvenance}
                            </span>
                          ) : null}
                        </th>
                        <td className="min-w-0 py-2 pr-2 align-top break-words text-slate-700">
                          {(catalogPdfUrlsBefore ?? []).join("\n") || "(trống)"}
                        </td>
                        <td className="min-w-0 py-2 pr-2 align-top break-words">
                          <textarea
                            value={(catalogPdfUrls ?? []).join("\n")}
                            onChange={(event) =>
                              onEditCatalogPdfUrls(event.target.value)
                            }
                            rows={Math.min(
                              4,
                              Math.max(1, catalogPdfUrls?.length ?? 1),
                            )}
                            placeholder="Một URL PDF mỗi dòng"
                            aria-label="URL catalog, mỗi dòng một URL PDF"
                            className="w-full max-w-full min-w-0 resize-y rounded border border-slate-500 bg-white px-1.5 py-0.5 text-xs font-medium break-words text-emerald-700 shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                          />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                {selectedSearchCandidate?.source === "web" &&
                selectedSearchCandidate.sourceUrl ? (
                  <div className="mt-3 space-y-1 border-t border-slate-200 pt-3">
                    <a
                      href={selectedSearchCandidate.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block max-w-full text-xs break-words text-blue-700 hover:underline"
                    >
                      {selectedSearchCandidate.title}
                    </a>
                    {selectedSearchCandidate.subtitle ? (
                      <p className="max-w-full text-xs break-words text-slate-600">
                        {selectedSearchCandidate.subtitle}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 grid gap-1.5">
                {plan.map((cell) => {
                  const field = cell.field;
                  const isFillable =
                    cell.action === "filled" || cell.action === "overwritten";
                  return (
                    <div
                      key={field}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                        isFillable ? "bg-slate-50" : "opacity-60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!isFillable}
                        checked={isFillable && accepted.has(field)}
                        onChange={() => onToggleField(field)}
                        aria-label={`Chấp nhận ${FIELD_LABELS[field]}`}
                      />
                      <span className="w-20 shrink-0 font-semibold text-slate-600">
                        {FIELD_LABELS[field]}
                      </span>
                      <span className="truncate text-slate-700">
                        {formatCompareFieldValue(
                          field,
                          cell.before || "",
                          sheetFields.currency,
                        ) ||
                          cell.before ||
                          "(trống)"}
                      </span>
                      {isFillable ? (
                        <>
                          <span className="text-slate-600">→</span>
                          {enableInlineEdit ? (
                            renderAfterFieldInput(
                              field,
                              editedValues[field] ?? cell.after,
                              (next) => onEditValue(field, next),
                              `Giá trị sau cho ${FIELD_LABELS[field]}`,
                            )
                          ) : (
                            <span
                              className={`min-w-0 flex-1 truncate ${afterFieldTextClass(field)}`}
                            >
                              {formatCompareFieldValue(
                                field,
                                editedValues[field] ?? cell.after,
                                editedValues.currency ?? sheetFields.currency,
                              ) ||
                                (editedValues[field] ?? cell.after)}
                            </span>
                          )}
                        </>
                      ) : cell.action === "kept" && enableOverwrite ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            onToggleOverwrite(field);
                          }}
                          className={`ml-auto rounded border px-1.5 py-0.5 text-xs font-semibold transition-colors ${
                            overwrite.has(field)
                              ? "border-amber-300 bg-amber-100 text-amber-800"
                              : "border-slate-500 bg-white text-slate-900 shadow-sm hover:border-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          Ghi đè
                        </button>
                      ) : (
                        <span className="ml-auto text-xs text-slate-600" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {plan.length === 0 ? (
              <p className="mt-2 text-xs text-slate-700">
                {selectedSearchCandidate?.source === "web"
                  ? "Kết quả web là liên kết tham khảo — không có trường để điền tự động."
                  : "Không có ô trống nào để điền cho lựa chọn này."}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onClear}>
                {clearLabel}
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-xs leading-5 text-slate-700">
            Chọn một sản phẩm hoặc kết quả AI ở bên trái để xem và chỉnh sửa các
            trường sẽ điền vào dòng này.
          </p>
        )}
      </section>
    ) : null;

  return (
    <div
      className={`max-w-full min-w-0 space-y-4 ${
        shouldSplitDecisionPane ? "profile-review-editor" : ""
      }`}
    >
      {/* Current row / material */}
      <div className="border-line bg-surface-2 max-w-full min-w-0 rounded border p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="section-title">{sheetLabel}</p>
            <p className="mt-1 max-w-full text-sm font-semibold break-words text-slate-900">
              {sheetName || "(không có tên)"}
            </p>
          </div>
          {enableSkip && onToggleSkip ? (
            <Button
              variant={isSkipped ? "warning" : "secondary"}
              size="sm"
              className="shrink-0"
              onClick={onToggleSkip}
            >
              {isSkipped ? skippedLabel : skipLabel}
            </Button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EDITABLE_FIELDS.map((field) => {
            const value = sheetFields[field]?.trim() ?? "";
            const isPrice = isPriceField(field);
            return (
              <span
                key={field}
                className={`max-w-full rounded border px-1.5 py-0.5 text-xs break-words ${
                  value
                    ? isPrice
                      ? "border-amber-300 bg-amber-50 font-semibold text-amber-900 tabular-nums shadow-sm"
                      : "border-slate-500 bg-white text-slate-900 shadow-sm"
                    : isPrice
                      ? "border-dashed border-amber-300 bg-amber-50/40 text-amber-800/70"
                      : "border-dashed border-slate-400 bg-transparent text-slate-600"
                }`}
              >
                {FIELD_LABELS[field]}:{" "}
                {value.length > 0
                  ? formatCompareFieldValue(
                      field,
                      value,
                      sheetFields.currency,
                    ) || value
                  : "(trống)"}
              </span>
            );
          })}
        </div>
      </div>

      {shouldSplitDecisionPane ? (
        <div className="profile-review-layout">
          <section
            aria-labelledby={candidatePaneHeadingId}
            className="profile-evidence max-w-full min-w-0 space-y-3"
          >
            <h3 id={candidatePaneHeadingId} className="section-title">
              Ứng viên và nguồn
            </h3>
            {candidatePane}
          </section>
          {fillPlanPane}
        </div>
      ) : (
        <>
          {candidatePane}
          {fillPlanPane}
        </>
      )}
    </div>
  );
}
