"use client";

import { useEffect, useMemo } from "react";
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

/**
 * Shared side-by-side compare + per-field edit panel. Extracted from the step-2
 * `MatchChooser` so the Excel-research review (step 3) and the material-enrich
 * dialog can present the same UX: sheet/current values on the left, the
 * proposed/found values per field, accept checkboxes, a "Ghi đè" overwrite
 * toggle for populated cells, and optional inline editing of the proposed value.
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
  /** Profile review: every field row is editable regardless of fill plan. */
  alwaysEditableFields?: boolean;
  /** Catalog PDF URLs extracted from web/AI search. */
  catalogPdfUrls?: string[];
  onEditCatalogPdfUrls?: (raw: string) => void;

  /** Web/AI search results shown as additional selectable candidate cards. */
  searchSourceCandidates?: SearchSourceCandidate[];
  selectedSearchCandidateKey?: string | null;
  onChooseSearchCandidate?: (key: string) => void;
  /** Profile: merge catalog + web/AI cards, sorted by score. */
  unifiedCandidateGrid?: boolean;
};

const EDITABLE_FIELDS = FILLABLE_FIELDS.filter(
  (field) => !NON_COLUMN_FIELDS.has(field),
);

function parsePriceInput(value: string) {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, "");
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
    ? "w-full rounded border border-amber-400 bg-amber-50/60 px-1.5 py-0.5 text-xs font-semibold text-amber-900 tabular-nums shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
    : "w-full rounded border border-slate-500 bg-white px-1.5 py-0.5 text-xs font-medium text-emerald-700 shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none";
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
  onEditCatalogPdfUrls,
  searchSourceCandidates = [],
  selectedSearchCandidateKey = null,
  onChooseSearchCandidate,
  unifiedCandidateGrid = false,
}: FieldCompareEditorProps) {
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
        fillCount: number;
        key: string;
      }
    | {
        kind: "search";
        candidate: SearchSourceCandidate;
        key: string;
      };

  const unifiedGridEntries = useMemo((): UnifiedGridEntry[] => {
    if (!unifiedCandidateGrid) return [];

    const entries: UnifiedGridEntry[] = [];
    for (const candidate of candidates) {
      entries.push({
        kind: "catalog",
        candidate,
        score: candidate.score ?? 0,
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
      entries.push({ kind: "search", candidate, key: candidate.key });
    }

    const isDeferred = (entry: UnifiedGridEntry) =>
      entry.kind === "search" &&
      (entry.candidate.status === "pending" || entry.candidate.status === "error");

    const ready = entries.filter((entry) => !isDeferred(entry));
    const deferred = entries.filter((entry) => isDeferred(entry));
    const catalogReady = ready.filter((entry) => entry.kind === "catalog");
    const searchReady = ready.filter((entry) => entry.kind === "search");

    catalogReady.sort((left, right) => right.score - left.score);
    searchReady.sort(
      (left, right) => right.candidate.score - left.candidate.score,
    );

    return [...catalogReady, ...searchReady, ...deferred];
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
      if (searchCandidate.status === "pending" || searchCandidate.status === "error") {
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
      ? searchSourceCandidates.find(
          (candidate) => candidate.key === selectedSearchCandidateKey,
        ) ?? null
      : null;

  return (
    <div className="space-y-4">
      {/* Current row / material */}
      <div className="rounded border border-slate-400 bg-slate-50 p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
              {sheetLabel}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
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
                className={`rounded border px-1.5 py-0.5 text-xs ${
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

      {/* Manual catalog search */}
      {enableCandidateGrid && onSearchTermChange ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-600"
            aria-hidden
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Tìm sản phẩm khác trong catalog…"
            spellCheck={false}
            className="w-full rounded border border-slate-400 py-2 pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          />
        </div>
      ) : null}

      {/* Candidate cards */}
      {enableCandidateGrid ? (
        showingSearch && isSearching ? (
          <p className="flex items-center gap-2 text-xs text-slate-700">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang tìm…
          </p>
        ) : candidates.length === 0 && searchSourceCandidates.length === 0 ? (
          <p className="rounded border border-dashed border-slate-400 bg-slate-50 px-3 py-6 text-center text-xs text-slate-700">
            {showingSearch
              ? "Không tìm thấy sản phẩm phù hợp."
              : "Không có ứng viên ghép tự động — hãy tìm thủ công hoặc chạy Tìm web / Tìm AI."}
          </p>
        ) : (
          <div className="space-y-2">
            {totalHotkeyCards > 0 ? (
              <p className="text-xs font-semibold text-slate-700">
                Mẹo: bấm phím 1-{Math.min(9, totalHotkeyCards)} để chọn nhanh ứng
                viên tương ứng.
              </p>
            ) : null}
            <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {unifiedCandidateGrid
                ? unifiedGridEntries.map((entry, index) => {
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
                          hotkeyIndex={index + 1}
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
                        hotkeyIndex={index + 1}
                      />
                    );
                  })
                : (
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
                        hotkeyIndex={catalogCardCount + index + 1}
                      />
                    ))}
                  </>
                )}
            </div>
          </div>
        )
      ) : null}

      {/* Fill plan: per-field accept / overwrite / inline edit */}
      {hasDecision ? (
        <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3">
          <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
            Sẽ điền vào dòng
          </p>
          {compareLayout === "sideBySide" ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-slate-600">
                    {!alwaysEditableFields ? (
                      <th className="w-8 py-2 pr-2" aria-label="Chọn trường" />
                    ) : null}
                    <th className="w-24 py-2 pr-2 font-semibold">Trường</th>
                    <th className="w-[40%] py-2 pr-2 font-semibold">Trước</th>
                    <th className="w-[40%] py-2 font-semibold">
                      {afterColumnLabel}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(alwaysEditableFields ? EDITABLE_FIELDS : plan.map((c) => c.field)).map(
                    (field) => {
                      const cell = plan.find((item) => item.field === field);
                      const isFillable = alwaysEditableFields
                        ? true
                        : cell?.action === "filled" ||
                          cell?.action === "overwritten";
                      const beforeValue =
                        sheetFields[field]?.trim() ??
                        cell?.before ??
                        "";
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
                          ? formatCompareFieldValue(field, afterValue, currency) ||
                            afterValue
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
                              <input
                                type="checkbox"
                                disabled={!isFillable}
                                checked={isFillable && accepted.has(field)}
                                onChange={() => onToggleField(field)}
                                aria-label={`Chấp nhận ${FIELD_LABELS[field]}`}
                              />
                            </td>
                          ) : null}
                          <td className="py-2 pr-2 align-top font-semibold text-slate-600">
                            {FIELD_LABELS[field]}
                          </td>
                          <td className={`py-2 pr-2 align-top ${beforeFieldClass(field)}`}>
                            {beforeDisplay}
                          </td>
                          <td className="py-2 pr-2 align-top">
                            {isFillable ? (
                              enableInlineEdit ? (
                                <input
                                  type="text"
                                  value={afterValue}
                                  onChange={(event) =>
                                    onEditValue(field, event.target.value)
                                  }
                                  className={`min-w-0 flex-1 ${afterFieldInputClass(field)}`}
                                />
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
                    },
                  )}
                  {onEditCatalogPdfUrls ? (
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      {!alwaysEditableFields ? (
                        <td className="py-2 pr-2 align-top">
                          <input
                            type="checkbox"
                            checked={(catalogPdfUrls?.length ?? 0) > 0}
                            readOnly
                            aria-label="URL catalog"
                            className="pointer-events-none opacity-70"
                          />
                        </td>
                      ) : null}
                      <td className="py-2 pr-2 align-top font-semibold text-slate-600">
                        URL catalog
                      </td>
                      <td className="py-2 pr-2 align-top text-slate-700">(trống)</td>
                      <td className="py-2 pr-2 align-top">
                        <textarea
                          value={(catalogPdfUrls ?? []).join("\n")}
                          onChange={(event) =>
                            onEditCatalogPdfUrls(event.target.value)
                          }
                          rows={Math.min(4, Math.max(1, catalogPdfUrls?.length ?? 1))}
                          placeholder="Một URL PDF mỗi dòng"
                          className="w-full rounded border border-slate-500 bg-white px-1.5 py-0.5 text-xs font-medium text-emerald-700 shadow-[var(--shadow-flat)] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {selectedSearchCandidate?.source === "web" &&
              selectedSearchCandidate.sourceUrl ? (
                <div className="mt-3 space-y-1 border-t border-slate-200 pt-3">
                  <p className="text-xs font-semibold text-slate-700">
                    Liên kết đã chọn
                  </p>
                  <a
                    href={selectedSearchCandidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-blue-700 hover:underline"
                  >
                    {selectedSearchCandidate.title}
                  </a>
                  {selectedSearchCandidate.subtitle ? (
                    <p className="text-xs text-slate-600">
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
                      ) || cell.before || "(trống)"}
                    </span>
                    {isFillable ? (
                      <>
                        <span className="text-slate-600">→</span>
                        {enableInlineEdit ? (
                          <input
                            type="text"
                            value={editedValues[field] ?? cell.after}
                            onChange={(event) =>
                              onEditValue(field, event.target.value)
                            }
                            className={`min-w-0 flex-1 ${afterFieldInputClass(field)}`}
                          />
                        ) : (
                          <span className={`min-w-0 flex-1 truncate ${afterFieldTextClass(field)}`}>
                            {formatCompareFieldValue(
                              field,
                              editedValues[field] ?? cell.after,
                              editedValues.currency ?? sheetFields.currency,
                            ) || (editedValues[field] ?? cell.after)}
                          </span>
                        )}
                      </>
                    ) : cell.action === "kept" && enableOverwrite ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
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
        </div>
      ) : null}
    </div>
  );
}
