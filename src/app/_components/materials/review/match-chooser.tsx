import { useEffect, useMemo, useState } from "react";
import { Globe, Loader2, Sparkles } from "lucide-react";

import { FieldCompareEditor } from "~/app/_components/enrich/field-compare-editor";
import {
  ManualProductForm,
  type ManualProductValues,
} from "~/app/_components/enrich/manual-product-dialog";
import { type EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import { planForCandidate } from "~/app/_components/materials/review/review-plan";
import type { SearchSourceCandidate } from "~/app/_components/materials/review/search-source-candidate-card";
import type { ReviewRow, ReviewSearchMode } from "~/app/_components/materials/review/review-types";
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

function profileSearchFields(decision: RowDecision | undefined) {
  return {
    webLinkResults: decision?.webLinkResults,
    webLinksStatus: decision?.webLinksStatus,
    aiSearchResult: decision?.aiSearchResult,
    aiSearchStatus: decision?.aiSearchStatus,
  };
}

export function MatchChooser({
  row,
  decision,
  onChange,
  searchMode = "default",
  onWebSearch,
  onWebLinksSearch,
  onAiSearch,
  isWebSearchPending,
  isWebLinksPending,
  isAiSearchPending,
}: {
  row: ReviewRow;
  decision: RowDecision | undefined;
  onChange: (next: RowDecision) => void;
  searchMode?: ReviewSearchMode;
  onWebSearch?: () => void;
  onWebLinksSearch?: () => void;
  onAiSearch?: () => void;
  isWebSearchPending?: boolean;
  isWebLinksPending?: boolean;
  isAiSearchPending?: boolean;
}) {
  const toast = useToast();
  const utils = api.useUtils();
  const [searchTerm, setSearchTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const isProfileSplit = searchMode === "profileSplit";

  useEffect(() => {
    const id = setTimeout(() => setDebounced(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const searchQuery = api.material.enrichSearchMaterials.useQuery(
    { query: debounced },
    { enabled: debounced.length > 0 },
  );
  const upsertMaterial = api.material.upsertMaterial.useMutation();

  const selectedId =
    decision?.selectedSource === "catalog" || decision?.selectedSource == null
      ? (decision?.materialId ?? null)
      : null;
  const selectedSearchSource =
    decision?.selectedSource === "web" || decision?.selectedSource === "ai"
      ? decision.selectedSource
      : null;
  const accepted = decision?.acceptedFields ?? new Set<FillableField>();
  const overwrite = decision?.overwriteFields ?? new Set<FillableField>();
  const editedValues = decision?.editedValues ?? {};
  const webProposedFields = decision?.webProposedFields ?? {};
  const webEvidence = decision?.webEvidence ?? [];
  const webSearchStatus = decision?.webSearchStatus;
  const profileFields = profileSearchFields(decision);

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

  const editorProposedFields =
    selectedSearchSource === "ai" && decision?.aiSearchResult
      ? decision.aiSearchResult.fields
      : webProposedFields;

  const searchSourceCandidates = useMemo((): SearchSourceCandidate[] => {
    if (!isProfileSplit) return [];

    const items: SearchSourceCandidate[] = [];

    const showWeb = [
      isWebLinksPending,
      decision?.webLinksStatus != null,
      (decision?.webLinkResults?.length ?? 0) > 0,
    ].some(Boolean);
    if (showWeb) {
      const links = decision?.webLinkResults ?? [];
      const top = links[0];
      const webTitle = top?.title?.trim();
      items.push({
        id: "web",
        source: "web",
        title:
          (webTitle && webTitle.length > 0 ? webTitle : row.name.trim()) ||
          "Kết quả tìm web",
        subtitle: isWebLinksPending
          ? "Đang tìm liên kết…"
          : links.length > 0
            ? `${links.length} liên kết${top?.domain ? ` · ${top.domain}` : ""}`
            : "Không có liên kết",
        fillCount: 0,
        links,
        sourceUrl: top?.url,
        status: isWebLinksPending
          ? "pending"
          : decision?.webLinksStatus === "error"
            ? "error"
            : links.length > 0
              ? "done"
              : "error",
      });
    }

    const showAi = [
      isAiSearchPending,
      decision?.aiSearchStatus != null,
      decision?.aiSearchResult != null,
    ].some(Boolean);
    if (showAi) {
      const ai = decision?.aiSearchResult;
      const fieldCount = ai
        ? Object.values(ai.fields).filter((value) => (value ?? "").trim()).length
        : 0;
      const fillCount = ai
        ? Object.keys(webFieldsAfterGapFill(sheetFields, null, ai.fields)).length
        : 0;
      const previewField = [
        ai?.fields.manufacturer,
        ai?.fields.code,
        ai?.fields.specText,
      ]
        .map((value) => value?.trim())
        .find((value) => (value?.length ?? 0) > 0);
      items.push({
        id: "ai",
        source: "ai",
        title:
          previewField ??
          (row.name.trim() || (isAiSearchPending ? "Đang tìm AI…" : "Kết quả AI")),
        subtitle: isAiSearchPending
          ? "Đang trích xuất trường…"
          : fieldCount > 0
            ? `${fieldCount} trường trích xuất`
            : "Không trích xuất được trường",
        fillCount,
        sourceUrl: ai?.sourceUrls[0],
        status: isAiSearchPending
          ? "pending"
          : decision?.aiSearchStatus === "error"
            ? "error"
            : ai && fieldCount > 0
              ? "done"
              : ai
                ? "error"
                : undefined,
      });
    }

    return items;
  }, [
    decision?.aiSearchResult,
    decision?.aiSearchStatus,
    decision?.webLinkResults,
    decision?.webLinksStatus,
    isAiSearchPending,
    isProfileSplit,
    isWebLinksPending,
    row.name,
    sheetFields,
  ]);

  const afterColumnLabel =
    selectedSearchSource === "ai"
      ? "Sau (AI)"
      : selectedSearchSource === "web"
        ? "Sau (Web)"
        : selectedCandidate
          ? `Sau (${selectedCandidate.name})`
          : "Sau";

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
      selectedSource: "catalog",
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
    });
  };

  const chooseSearchSource = (source: "web" | "ai") => {
    if (source === "web") {
      const links = decision?.webLinkResults ?? [];
      if (links.length === 0) {
        toast.warning("Chưa có liên kết web để chọn.");
        return;
      }
      onChange({
        materialId: null,
        selectedSource: "web",
        acceptedFields: new Set(),
        overwriteFields: new Set(),
        editedValues: {},
        webProposedFields: {},
        webEvidence: [],
        webSearchStatus,
        ...profileFields,
      });
      return;
    }

    const aiResult = decision?.aiSearchResult;
    if (!aiResult) {
      toast.warning("Chưa có kết quả AI để chọn.");
      return;
    }
    const gapFields = webFieldsAfterGapFill(sheetFields, null, aiResult.fields);
    const nextAccepted = new Set<FillableField>();
    const nextEdited: Partial<Record<FillableField, string>> = {};
    for (const [field, value] of Object.entries(gapFields)) {
      const fillableField = field as FillableField;
      nextAccepted.add(fillableField);
      nextEdited[fillableField] = value;
    }
    onChange({
      materialId: null,
      selectedSource: "ai",
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields: { ...aiResult.fields },
      webEvidence: aiResult.evidence,
      webSearchStatus,
      ...profileFields,
    });
  };

  const isSkipped = decision?.skipped === true;

  const toggleSkip = () => {
    onChange({
      materialId: null,
      selectedSource: undefined,
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
      skipped: !isSkipped,
      ...profileFields,
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
      selectedSource: decision?.selectedSource,
      acceptedFields: next,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields: editorProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
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
      selectedSource: decision?.selectedSource,
      acceptedFields: nextAccepted,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields: editorProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
    });
  };

  const editValue = (field: FillableField, value: string) => {
    const nextEdited = { ...editedValues, [field]: value };
    const nextAccepted = new Set(accepted);
    nextAccepted.add(field);
    onChange({
      materialId: selectedId,
      selectedSource: decision?.selectedSource,
      acceptedFields: nextAccepted,
      overwriteFields: overwrite,
      editedValues: nextEdited,
      webProposedFields: editorProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
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
      selectedSource: undefined,
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields: {},
      webEvidence: [],
      ...profileFields,
    });
  };

  const saveCurrentToMaterials = () => {
    const effective = effectiveAcceptedFieldValues(
      sheetFields,
      catalogFields,
      {
        acceptedFields: accepted,
        editedValues,
        webProposedFields: editorProposedFields,
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
          toast.error(error.message ?? "Không lưu được vật tư.");
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
      selectedSource: undefined,
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
      ...profileFields,
    });
  };

  const hasWebOrManualDecision =
    selectedSearchSource != null ||
    Object.keys(webProposedFields).length > 0 ||
    (selectedId == null &&
      (accepted.size > 0 ||
        Object.values(editedValues).some(
          (value) => (value ?? "").trim().length > 0,
        )));

  const rowNameMissing = row.name.trim().length === 0;
  const canSaveToMaterials =
    accepted.size > 0 &&
    !isWebSearchPending &&
    !isWebLinksPending &&
    !isAiSearchPending;
  const isSavingMaterial = upsertMaterial.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {isProfileSplit ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={onWebLinksSearch}
              disabled={[isWebLinksPending, rowNameMissing].some(Boolean)}
            >
              {isWebLinksPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Globe className="h-4 w-4" aria-hidden />
              )}
              Tìm web
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onAiSearch}
              disabled={[isAiSearchPending, rowNameMissing].some(Boolean)}
            >
              {isAiSearchPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              Tìm AI
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onWebSearch}
            disabled={[isWebSearchPending, rowNameMissing].some(Boolean)}
          >
            {isWebSearchPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Globe className="h-4 w-4" aria-hidden />
            )}
            Tìm web
          </Button>
        )}
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
        proposedFields={editorProposedFields}
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
        compareLayout={isProfileSplit ? "sideBySide" : "inline"}
        afterColumnLabel={afterColumnLabel}
        searchSourceCandidates={searchSourceCandidates}
        selectedSearchSource={selectedSearchSource}
        onChooseSearchSource={isProfileSplit ? chooseSearchSource : undefined}
      />

      {!isProfileSplit && webEvidence.length > 0 && !isWebSearchPending ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">Bằng chứng web</p>
          {webEvidence.slice(0, 6).map((item, index) => (
            <div
              key={`${item.field}-${item.sourceUrl ?? index}`}
              className="rounded border border-slate-500 bg-white p-2 text-xs shadow-[var(--shadow-flat)]"
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
