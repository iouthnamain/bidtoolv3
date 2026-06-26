import { useEffect, useState } from "react";
import { Globe, Loader2 } from "lucide-react";

import { FieldCompareEditor } from "~/app/_components/enrich/field-compare-editor";
import {
  ManualProductForm,
  type ManualProductValues,
} from "~/app/_components/enrich/manual-product-dialog";
import { type EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import { planForCandidate } from "~/app/_components/materials/review/review-plan";
import type { ReviewRow } from "~/app/_components/materials/review/review-types";
import { Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  applySavedMaterialToDecision,
  effectiveAcceptedFieldValues,
  webFieldsAfterGapFill,
} from "~/lib/materials/enrich-gap-fill";
import {
  candidateToFields,
  FIELD_LABELS,
  type FillableField,
  FILLABLE_FIELDS,
} from "~/lib/materials/excel-enrich-fields";
import type { RowDecision } from "~/lib/materials/review-decision";
import { parseOptionalNumber } from "~/lib/materials/format";
import { api } from "~/trpc/react";

export function MatchChooser({
  row,
  decision,
  onChange,
  onWebSearch,
  isWebSearchPending,
}: {
  row: ReviewRow;
  decision: RowDecision | undefined;
  onChange: (next: RowDecision) => void;
  onWebSearch: () => void;
  isWebSearchPending: boolean;
}) {
  const toast = useToast();
  const utils = api.useUtils();
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
  const upsertMaterial = api.material.upsertMaterial.useMutation();

  const selectedId = decision?.materialId ?? null;
  const accepted = decision?.acceptedFields ?? new Set<FillableField>();
  const overwrite = decision?.overwriteFields ?? new Set<FillableField>();
  const editedValues = decision?.editedValues ?? {};
  const webProposedFields = decision?.webProposedFields ?? {};
  const webEvidence = decision?.webEvidence ?? [];
  const webSearchStatus = decision?.webSearchStatus;

  const sheetFields: Partial<Record<FillableField, string>> = row.sheetFields;

  const searchCandidates = (searchQuery.data?.candidates ??
    []) as EnrichCandidate[];
  const showingSearch = debounced.length > 0;
  const cards: EnrichCandidate[] = showingSearch
    ? searchCandidates
    : row.candidates;

  const selectedCandidate =
    selectedId != null
      ? (cards.find((candidate) => candidate.materialId === selectedId) ??
        row.candidates.find((candidate) => candidate.materialId === selectedId) ??
        null)
      : null;

  const catalogFields = selectedCandidate
    ? candidateToFields(selectedCandidate)
    : null;

  const choose = (candidate: EnrichCandidate) => {
    const { fillable } = planForCandidate(sheetFields, candidate);
    const candidateFields = candidateToFields(candidate);
    const webGaps = webFieldsAfterGapFill(
      sheetFields,
      candidateFields,
      webProposedFields,
    );
    const nextAccepted = new Set(fillable);
    const nextEdited = { ...editedValues };
    for (const [field, value] of Object.entries(webGaps)) {
      const fillableField = field as FillableField;
      nextAccepted.add(fillableField);
      if (!(fillableField in nextEdited)) {
        nextEdited[fillableField] = value;
      }
    }
    onChange({
      materialId: candidate.materialId,
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields,
      webEvidence,
      webSearchStatus,
    });
  };

  const isSkipped = decision?.skipped === true;

  const toggleSkip = () => {
    onChange({
      materialId: null,
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
      skipped: !isSkipped,
    });
  };

  const toggleField = (field: FillableField) => {
    const next = new Set(accepted);
    const nextOverwrite = new Set(overwrite);
    if (next.has(field)) {
      next.delete(field);
      nextOverwrite.delete(field);
    } else {
      next.add(field);
    }
    onChange({
      materialId: selectedId,
      acceptedFields: next,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields,
      webEvidence,
      webSearchStatus,
    });
  };

  const toggleOverwrite = (field: FillableField) => {
    const nextOverwrite = new Set(overwrite);
    const nextAccepted = new Set(accepted);
    if (nextOverwrite.has(field)) {
      nextOverwrite.delete(field);
      nextAccepted.delete(field);
    } else {
      nextOverwrite.add(field);
      nextAccepted.add(field);
    }
    onChange({
      materialId: selectedId,
      acceptedFields: nextAccepted,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields,
      webEvidence,
      webSearchStatus,
    });
  };

  const editValue = (field: FillableField, value: string) => {
    const nextEdited = { ...editedValues, [field]: value };
    const nextAccepted = new Set(accepted);
    nextAccepted.add(field);
    onChange({
      materialId: selectedId,
      acceptedFields: nextAccepted,
      overwriteFields: overwrite,
      editedValues: nextEdited,
      webProposedFields,
      webEvidence,
      webSearchStatus,
    });
  };

  const applyManualValues = (values: ManualProductValues) => {
    const nextAccepted = new Set<FillableField>();
    const nextEdited: Partial<Record<FillableField, string>> = {};
    for (const field of FILLABLE_FIELDS) {
      if (field === "currency") continue;
      const value = values[field]?.trim() ?? "";
      if (value) {
        nextEdited[field] = value;
        nextAccepted.add(field);
      }
    }
    onChange({
      materialId: null,
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields: {},
      webEvidence: [],
    });
  };

  const saveCurrentToMaterials = () => {
    const effective = effectiveAcceptedFieldValues(
      sheetFields,
      catalogFields,
      {
        acceptedFields: accepted,
        editedValues,
        webProposedFields,
        overwriteFields: overwrite,
      },
    );
    const unit = effective.unit?.trim() ?? sheetFields.unit?.trim() ?? "";
    const name = row.name.trim();
    if (!name) {
      toast.error("Tên vật tư không được để trống.");
      return;
    }
    if (!unit) {
      toast.error("ĐVT không được để trống.");
      return;
    }
    if (accepted.size === 0) {
      toast.error("Chọn ít nhất một trường trước khi lưu.");
      return;
    }

    const trimmedOrUndefined = (value: string | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed) {
        return undefined;
      }
      return trimmed;
    };

    upsertMaterial.mutate(
      {
        id: selectedId ?? undefined,
        patch: {
          name,
          unit,
          code: trimmedOrUndefined(effective.code),
          category: trimmedOrUndefined(effective.category),
          specText: trimmedOrUndefined(effective.specText),
          manufacturer: trimmedOrUndefined(effective.manufacturer),
          originCountry: trimmedOrUndefined(effective.originCountry),
          defaultUnitPrice: parseOptionalNumber(
            effective.defaultUnitPrice ?? "",
          ),
          sourceUrl: trimmedOrUndefined(effective.sourceUrl),
          currency: "VND",
        },
      },
      {
        onSuccess: (material) => {
          if (!material) {
            toast.error("Không lưu được vật tư.");
            return;
          }
          void utils.material.enrichSearchMaterials.invalidate();
          onChange(
            applySavedMaterialToDecision(material.id, effective, decision),
          );
          toast.success(
            selectedId != null
              ? "Đã cập nhật vật tư."
              : "Đã lưu vào vật tư.",
          );
        },
        onError: (error) => {
          if (error.data?.code === "CONFLICT") {
            toast.error("Mã vật tư đã tồn tại.");
            return;
          }
          toast.error(error.message || "Không lưu được vật tư.");
        },
      },
    );
  };

  const handleSavedToCatalog = (
    materialId: number,
    values: ManualProductValues,
  ) => {
    const savedFields: Partial<Record<FillableField, string>> = {};
    for (const field of FILLABLE_FIELDS) {
      if (field === "currency") continue;
      const value = values[field]?.trim() ?? "";
      if (value) savedFields[field] = value;
    }
    void utils.material.enrichSearchMaterials.invalidate();
    onChange(applySavedMaterialToDecision(materialId, savedFields, decision));
  };

  const clearDecision = () => {
    onChange({
      materialId: null,
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
    });
  };

  const hasWebOrManualDecision =
    Object.keys(webProposedFields).length > 0 ||
    (selectedId == null &&
      (accepted.size > 0 ||
        Object.values(editedValues).some(
          (value) => (value ?? "").trim().length > 0,
        )));

  const canSaveToMaterials = accepted.size > 0 && !isWebSearchPending;
  const isSavingMaterial = upsertMaterial.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onWebSearch}
          disabled={isWebSearchPending || !row.name.trim()}
        >
          {isWebSearchPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Globe className="h-4 w-4" aria-hidden />
          )}
          Tìm web
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={saveCurrentToMaterials}
          disabled={!canSaveToMaterials || isSavingMaterial}
          title={
            canSaveToMaterials
              ? "Lưu các trường đã chọn vào danh mục vật tư"
              : "Chọn ít nhất một trường để lưu"
          }
        >
          {isSavingMaterial ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : null}
          Lưu vào vật tư
        </Button>
      </div>

      <FieldCompareEditor
        sheetLabel={`Dòng Excel ${row.originalRowIndex}`}
        sheetName={row.name}
        sheetFields={sheetFields}
        proposedFields={webProposedFields}
        selectedMaterialId={selectedId}
        accepted={accepted}
        overwrite={overwrite}
        editedValues={editedValues}
        onToggleField={toggleField}
        onToggleOverwrite={toggleOverwrite}
        onEditValue={editValue}
        onClear={clearDecision}
        enableCandidateGrid
        candidates={cards}
        recommendedMaterialId={row.topCandidate?.materialId ?? null}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        isSearching={searchQuery.isLoading}
        showingSearch={showingSearch}
        onChoose={choose}
        enableInlineEdit
        enableSkip
        isSkipped={isSkipped}
        onToggleSkip={toggleSkip}
        forceShowDecision={hasWebOrManualDecision}
      />

      {webEvidence.length > 0 && !isWebSearchPending ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">Bằng chứng web</p>
          {webEvidence.slice(0, 6).map((item, index) => (
            <div
              key={`${item.field}-${item.sourceUrl ?? index}`}
              className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-2 text-xs"
            >
              <p className="font-semibold text-slate-700">
                {FIELD_LABELS[item.field as FillableField] ?? item.field}
              </p>
              <p className="mt-0.5 text-slate-600">{item.snippet}</p>
              {item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-blue-700 hover:underline"
                >
                  {item.sourceUrl}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <ManualProductForm
        productName={row.name}
        sheetFields={sheetFields}
        selectedCandidate={selectedCandidate}
        onApplyToRow={applyManualValues}
        onSavedToCatalog={handleSavedToCatalog}
      />
    </div>
  );
}
