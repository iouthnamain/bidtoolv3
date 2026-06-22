"use client";

import { useEffect } from "react";
import { Loader2, Search } from "lucide-react";

import { Button } from "~/app/_components/ui";
import {
  ProductCandidateCard,
  type EnrichCandidate,
} from "~/app/_components/enrich/product-candidate-card";
import { mergeWebGapFill } from "~/lib/materials/enrich-gap-fill";
import {
  buildFillPlanWithEdits,
  candidateToFields,
  FIELD_LABELS,
  FILLABLE_FIELDS,
  NON_COLUMN_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";

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
};

const EDITABLE_FIELDS = FILLABLE_FIELDS.filter(
  (field) => !NON_COLUMN_FIELDS.has(field),
);

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
  enableSkip = false,
  isSkipped = false,
  onToggleSkip,
  skipLabel = "Bỏ qua dòng này",
  skippedLabel = "Bỏ qua: bật",
  clearLabel = "Bỏ ghép dòng này",
  forceShowDecision = false,
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
    hasProposed ||
    Object.values(editedValues).some((v) => (v ?? "").trim().length > 0);

  // Digit keys 1-9 select the matching candidate card. Guarded so typing in the
  // manual-search box (or any text field) never hijacks the keystroke.
  useEffect(() => {
    if (!enableCandidateGrid || !onChoose) return;
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
      const candidate = candidates[digit - 1];
      if (!candidate) return;
      event.preventDefault();
      onChoose(candidate);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // A fresh handler whenever the candidate list changes (i.e. row/search
    // changes) is exactly what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, enableCandidateGrid]);

  return (
    <div className="space-y-4">
      {/* Current row / material */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
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
            return (
              <span
                key={field}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  value
                    ? "border-slate-200 bg-white text-slate-600"
                    : "border-dashed border-slate-300 bg-transparent text-slate-400"
                }`}
              >
                {FIELD_LABELS[field]}: {value.length > 0 ? value : "(trống)"}
              </span>
            );
          })}
        </div>
      </div>

      {/* Manual catalog search */}
      {enableCandidateGrid && onSearchTermChange ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Tìm sản phẩm khác trong catalog…"
            spellCheck={false}
            className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          />
        </div>
      ) : null}

      {/* Candidate cards */}
      {enableCandidateGrid ? (
        showingSearch && isSearching ? (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang tìm…
          </p>
        ) : candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
            {showingSearch
              ? "Không tìm thấy sản phẩm phù hợp."
              : "Không có ứng viên ghép tự động — hãy tìm thủ công ở trên."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((candidate, index) => (
              <ProductCandidateCard
                key={candidate.materialId}
                candidate={candidate}
                isSelected={candidate.materialId === selectedMaterialId}
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
          </div>
        )
      ) : null}

      {/* Fill plan: per-field accept / overwrite / inline edit */}
      {hasDecision ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
            Sẽ điền vào dòng
          </p>
          <div className="mt-2 grid gap-1.5">
            {plan.map((cell) => {
              const field = cell.field;
              const isFillable =
                cell.action === "filled" || cell.action === "overwritten";
              return (
                <div
                  key={field}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
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
                  <span className="truncate text-slate-500">
                    {cell.before || "(trống)"}
                  </span>
                  {isFillable ? (
                    <>
                      <span className="text-slate-400">→</span>
                      {enableInlineEdit ? (
                        <input
                          type="text"
                          value={editedValues[field] ?? cell.after}
                          onChange={(event) =>
                            onEditValue(field, event.target.value)
                          }
                          className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-emerald-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
                        />
                      ) : (
                        <span className="truncate font-medium text-emerald-700">
                          {cell.after}
                        </span>
                      )}
                    </>
                  ) : cell.action === "kept" ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        onToggleOverwrite(field);
                      }}
                      className={`ml-auto rounded border px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
                        overwrite.has(field)
                          ? "border-amber-300 bg-amber-100 text-amber-800"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      Ghi đè
                    </button>
                  ) : (
                    <span className="ml-auto text-[11px] text-slate-400" />
                  )}
                </div>
              );
            })}
            {plan.length === 0 ? (
              <p className="text-xs text-slate-500">
                Không có ô trống nào để điền cho lựa chọn này.
              </p>
            ) : null}
          </div>
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
